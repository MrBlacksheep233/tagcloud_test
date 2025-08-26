// 初始化高德地图
const map = new AMap.Map("mapContainer", {
  zoom: 12,
  center: [114.305215, 30.592935],
});

// Paper.js 画布初始化
paper.setup("paperCanvas");

// 画布平移缩放交互
let isDragging = false;
let lastPoint = null;
let lastCenter = null;
if (paper.view.element) {
  paper.view.element.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      const oldZoom = paper.view.zoom;
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      // 鼠标位置为缩放中心
      const mousePos = new paper.Point(e.offsetX, e.offsetY);
      const viewPos = paper.view.viewToProject(mousePos);
      paper.view.zoom = Math.max(0.2, Math.min(10, oldZoom * delta));
      // 缩放后保持鼠标点位置不变
      const newViewPos = paper.view.viewToProject(mousePos);
      const offset = newViewPos.subtract(viewPos);
      paper.view.center = paper.view.center.subtract(offset);
      paper.view.draw();
    },
    { passive: false }
  );
}
paper.view.onMouseDown = function (event) {
  isDragging = true;
  lastPoint = event.point;
  lastCenter = paper.view.center;
};
paper.view.onMouseDrag = function (event) {
  if (!isDragging || !lastPoint || !lastCenter) return;
  paper.view.center = lastCenter.subtract(event.point.subtract(lastPoint));
  paper.view.draw();
};
paper.view.onMouseUp = function (event) {
  isDragging = false;
  lastPoint = null;
  lastCenter = null;
};

// 同步画布到地图bbox并在中心生成标签
document.getElementById("syncBboxBtn").addEventListener("click", function () {
  // 获取高德地图当前范围
  var center = map.getCenter();
  // 画布中心点
  var centerPoint = paper.view.center;
  // 清除旧标签
  if (window._centerTag) {
    window._centerTag.remove();
  }
  // 生成中心标签
  var text = new paper.PointText({
    point: centerPoint,
    content: "中心位置",
    fillColor: "black",
    fontSize: 16,
    justification: "center",
  });
  window._centerTag = text;

  // 加载点数据并显示标签
  fetch("data/武汉市街道级点数据.json")
    .then((res) => res.json())
    .then((data) => {
      // 获取地图范围
      var bounds = map.getBounds();
      var sw = bounds.getSouthWest();
      var ne = bounds.getNorthEast();
      var minLng = sw.getLng();
      var maxLng = ne.getLng();
      var minLat = sw.getLat();
      var maxLat = ne.getLat();
      var canvas = document.getElementById("paperCanvas");
      // 画布中心经纬（用于点到画布坐标转换）
      var centerLng = center.getLng();
      var centerLat = center.getLat();
      function lnglat2xy(lng, lat) {
        var x = ((lng - minLng) / (maxLng - minLng)) * canvas.width;
        var y =
          canvas.height - ((lat - minLat) / (maxLat - minLat)) * canvas.height;
        return { x, y };
      }
      var centerXY = lnglat2xy(centerLng, centerLat);
      // 清除旧点标签
      if (window._pointTags) window._pointTags.forEach((t) => t.remove());
      window._pointTags = [];
      // 筛选范围内的点
      var features = data.features.filter((f) => {
        var coords = f.geometry.coordinates;
        var lng = coords[0];
        var lat = coords[1];
        return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
      });
      // 计算距离和角度
      var tagList = features.map((f) => {
        var coords = f.geometry.coordinates;
        var xy = lnglat2xy(coords[0], coords[1]);
        var dx = xy.x - centerXY.x;
        var dy = xy.y - centerXY.y;
        var r = Math.sqrt(dx * dx + dy * dy);
        var phi = Math.atan2(dy, dx);
        return {
          name: f.properties.NAME || "",
          r,
          phi,
        };
      });
      // 按 r 升序排序
      tagList.sort((a, b) => a.r - b.r);
      // 统计 rmin, rmax
      var rmin = tagList.length ? tagList[0].r : 0;
      var rmax = tagList.length ? tagList[tagList.length - 1].r : 1;
      var h = canvas.height;
      var centerPointView = paper.view.center;
      // 摆放标签（带优化碰撞检测和径向移位，中心标签也参与检测）
      var placedTags = [];
      placedTags.push(text); // 中心标签参与检测

      function rotateAroundCenter(cx, cy, x, y, angleDeg) {
        var angle = (angleDeg * Math.PI) / 180;
        var dx = x - cx,
          dy = y - cy;
        var cos = Math.cos(angle),
          sin = Math.sin(angle);
        return {
          x: cx + cos * dx - sin * dy,
          y: cy + sin * dx + cos * dy,
        };
      }

      tagList.forEach((tag, i) => {
        var Ri =
          rmax === rmin ? 0 : ((tag.r - rmin) / (rmax - rmin)) * h * 0.25;
        var maxRadius = h * 0.25;
        var step = 20;
        var centerX = centerPointView.x,
          centerY = centerPointView.y;
        var baseX = centerX + Ri * Math.cos(tag.phi);
        var baseY = centerY + Ri * Math.sin(tag.phi);

        // 多角度尝试
        var angles = [-15, -10, -5, 0, 5, 10, 15];
        var found = false,
          pt;
        for (
          var radiusTry = 0;
          radiusTry < Math.ceil(maxRadius / step);
          radiusTry++
        ) {
          for (var a = 0; a < angles.length; a++) {
            var pos = rotateAroundCenter(
              centerX,
              centerY,
              baseX,
              baseY,
              angles[a]
            );
            pt = new paper.PointText({
              point: [pos.x, pos.y],
              content: tag.name,
              fillColor: "red",
              fontSize: 12,
              justification: "center",
            });
            // 添加边框（用于碰撞检测）
            var rect = new paper.Path.Rectangle(pt.bounds);
            rect.strokeColor = null;
            rect.strokeWidth = 0;
            rect.sendToBack();
            pt._borderRect = rect; // 方便后续管理

            // 检查碰撞，至少间隔1px
            var overlapped = placedTags.some((other) => {
              if (!pt.bounds || !other.bounds) return false;
              var a = pt.bounds;
              var b = other.bounds;
              var aInflate = a.clone();
              aInflate.x -= 1;
              aInflate.y -= 1;
              aInflate.width += 2;
              aInflate.height += 2;
              var bInflate = b.clone();
              bInflate.x -= 1;
              bInflate.y -= 1;
              bInflate.width += 2;
              bInflate.height += 2;
              return aInflate.intersects(bInflate);
            });
            if (!overlapped) {
              found = true;
              break;
            } else {
              pt.remove();
              rect.remove();
            }
          }
          if (found) break;
          // 所有角度都重叠则径向外移
          Ri += step;
          baseX = centerX + Ri * Math.cos(tag.phi);
          baseY = centerY + Ri * Math.sin(tag.phi);
        }
        window._pointTags.push(pt);
        placedTags.push(pt);
      });
      paper.view.draw();
    })
    .catch((err) => {
      console.error("加载点数据失败", err);
    });

  // 加载线数据并显示（采样点推离障碍矩形 + 平滑）
  fetch("data/长江线化(武汉).geojson")
    .then((res) => res.json())
    .then((data) => {
      // 获取地图范围
      var bounds = map.getBounds();
      var sw = bounds.getSouthWest();
      var ne = bounds.getNorthEast();
      var minLng = sw.getLng();
      var maxLng = ne.getLng();
      var minLat = sw.getLat();
      var maxLat = ne.getLat();
      var canvas = document.getElementById("paperCanvas");
      function lnglat2xy(lng, lat) {
        var x = ((lng - minLng) / (maxLng - minLng)) * canvas.width;
        var y =
          canvas.height - ((lat - minLat) / (maxLat - minLat)) * canvas.height;
        return { x, y };
      }
      // 清除旧线条
      if (window._linePaths) window._linePaths.forEach((p) => p.remove());
      window._linePaths = [];

      // 构造膨胀后的标签矩形列表（障碍区）
      var padding = 2;
      var rects = (window._pointTags || [])
        .map((t) => {
          var b = t.bounds ? t.bounds.clone() : null;
          if (!b) return null;
          return {
            x: b.x - padding,
            y: b.y - padding,
            w: b.width + padding * 2,
            h: b.height + padding * 2,
          };
        })
        .filter(Boolean);

      // 简单空间哈希
      var cellSize = 120;
      var grid = Object.create(null);
      function addRectToGrid(idx, r) {
        var x0 = Math.floor(r.x / cellSize);
        var y0 = Math.floor(r.y / cellSize);
        var x1 = Math.floor((r.x + r.w) / cellSize);
        var y1 = Math.floor((r.y + r.h) / cellSize);
        for (var ix = x0; ix <= x1; ix++) {
          for (var iy = y0; iy <= y1; iy++) {
            var k = ix + "_" + iy;
            if (!grid[k]) grid[k] = [];
            grid[k].push(idx);
          }
        }
      }
      for (var ri = 0; ri < rects.length; ri++) addRectToGrid(ri, rects[ri]);

      function candidateRectIdxForPoint(pt) {
        var ix = Math.floor(pt.x / cellSize);
        var iy = Math.floor(pt.y / cellSize);
        var idxs = [];
        var seen = Object.create(null);
        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            var k = ix + dx + "_" + (iy + dy);
            var arr = grid[k];
            if (!arr) continue;
            for (var i = 0; i < arr.length; i++) {
              var id = arr[i];
              if (!seen[id]) {
                seen[id] = true;
                idxs.push(id);
              }
            }
          }
        }
        return idxs;
      }

      function pointInRect(pt, r) {
        return (
          pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h
        );
      }

      // --- 替换：把点投影到矩形边界并沿矩形周长替换连续投影段 ---
      function projectPointToRectBoundary(pt, r, gap) {
        gap = gap || 0;
        // clamp to rectangle
        var cx = Math.max(r.x, Math.min(r.x + r.w, pt.x));
        var cy = Math.max(r.y, Math.min(r.y + r.h, pt.y));
        var onLeft = Math.abs(cx - r.x) < 1e-8;
        var onRight = Math.abs(cx - (r.x + r.w)) < 1e-8;
        var onTop = Math.abs(cy - r.y) < 1e-8;
        var onBottom = Math.abs(cy - (r.y + r.h)) < 1e-8;
        var out = { x: cx, y: cy, side: null };
        if (onTop && !onLeft && !onRight) {
          out.side = "top";
          out.y = r.y - gap;
        } else if (onBottom && !onLeft && !onRight) {
          out.side = "bottom";
          out.y = r.y + r.h + gap;
        } else if (onLeft && !onTop && !onBottom) {
          out.side = "left";
          out.x = r.x - gap;
        } else if (onRight && !onTop && !onBottom) {
          out.side = "right";
          out.x = r.x + r.w + gap;
        } else {
          // corner or interior: determine closest edge by distance
          var dl = Math.abs(pt.x - r.x),
            dr = Math.abs(pt.x - (r.x + r.w));
          var dt = Math.abs(pt.y - r.y),
            db = Math.abs(pt.y - (r.y + r.h));
          var minD = Math.min(dl, dr, dt, db);
          if (minD === dl) {
            out.side = "left";
            out.x = r.x - gap;
            out.y = Math.max(r.y - gap, Math.min(r.y + r.h + gap, pt.y));
          } else if (minD === dr) {
            out.side = "right";
            out.x = r.x + r.w + gap;
            out.y = Math.max(r.y - gap, Math.min(r.y + r.h + gap, pt.y));
          } else if (minD === dt) {
            out.side = "top";
            out.y = r.y - gap;
            out.x = Math.max(r.x - gap, Math.min(r.x + r.w + gap, pt.x));
          } else {
            out.side = "bottom";
            out.y = r.y + r.h + gap;
            out.x = Math.max(r.x - gap, Math.min(r.x + r.w + gap, pt.x));
          }
        }
        return out;
      }

      function perimeterLength(r) {
        return 2 * (r.w + r.h);
      }

      // 以 c0 (top-left) 为起点，顺时针计算点在周长上的长度值
      function lengthAlongPerimeterFromC0(p, r) {
        var w = r.w,
          h = r.h;
        // assume p is on boundary (x in [r.x,r.x+w], y in [r.y,r.y+h]) possibly offset by gap -- clamp projection to exact edge
        var x = Math.max(r.x, Math.min(r.x + r.w, p.x));
        var y = Math.max(r.y, Math.min(r.y + r.h, p.y));
        if (Math.abs(y - r.y) < 1e-6) {
          // top edge
          return x - r.x;
        } else if (Math.abs(x - (r.x + r.w)) < 1e-6) {
          // right edge
          return w + (y - r.y);
        } else if (Math.abs(y - (r.y + r.h)) < 1e-6) {
          // bottom edge (go from top-right to bottom-right to bottom-left)
          return w + h + (r.x + r.w - x);
        } else {
          // left edge
          return 2 * w + h + (r.y + r.h - y);
        }
      }

      // ----- 新增：线段相交检测工具 -----
      function segIntersects(a1, a2, b1, b2) {
        // 排除共享端点的相交判断（认为端点相接不算交叉）
        function cross(p, q, r) {
          return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        }
        if (
          (a1.x === b1.x && a1.y === b1.y) ||
          (a1.x === b2.x && a1.y === b2.y) ||
          (a2.x === b1.x && a2.y === b1.y) ||
          (a2.x === b2.x && a2.y === b2.y)
        ) {
          return false;
        }
        if (
          Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) ||
          Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) ||
          Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) ||
          Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)
        ) {
          // bbox reject - still could be collinear edge touching, but acceptable
        }
        var c1 = cross(a1, a2, b1);
        var c2 = cross(a1, a2, b2);
        var c3 = cross(b1, b2, a1);
        var c4 = cross(b1, b2, a2);
        return c1 * c2 <= 0 && c3 * c4 <= 0;
      }

      function pathIntersectsAny(pathPts, outPts) {
        if (!pathPts || pathPts.length < 2 || !outPts || outPts.length < 2)
          return false;
        for (var i = 0; i < pathPts.length - 1; i++) {
          var a1 = pathPts[i],
            a2 = pathPts[i + 1];
          for (var j = 0; j < outPts.length - 1; j++) {
            var b1 = outPts[j],
              b2 = outPts[j + 1];
            // skip adjacent connections (allow touching at join)
            if (
              (Math.abs(a1.x - b1.x) < 1e-8 && Math.abs(a1.y - b1.y) < 1e-8) ||
              (Math.abs(a1.x - b2.x) < 1e-8 && Math.abs(a1.y - b2.y) < 1e-8) ||
              (Math.abs(a2.x - b1.x) < 1e-8 && Math.abs(a2.y - b1.y) < 1e-8) ||
              (Math.abs(a2.x - b2.x) < 1e-8 && Math.abs(a2.y - b2.y) < 1e-8)
            ) {
              continue;
            }
            if (segIntersects(a1, a2, b1, b2)) return true;
          }
        }
        return false;
      }

      // ----- 修改：buildBoundaryPathBetween 返回两条候选路径（cw/ccw）-----
      function buildBoundaryPathsBetween(r, pA, pB) {
        // 稳健实现：按周长参数从 start -> end 顺时针收集角点（支持 wrap），对同边情形保证端点顺序
        var perim = perimeterLength(r);
        var corners = [
          { x: r.x, y: r.y },                 // top-left
          { x: r.x + r.w, y: r.y },           // top-right
          { x: r.x + r.w, y: r.y + r.h },     // bottom-right
          { x: r.x, y: r.y + r.h }            // bottom-left
        ];
        var cornerLens = corners.map(function(c){ return lengthAlongPerimeterFromC0(c, r); });
        var lenA = lengthAlongPerimeterFromC0(pA, r);
        var lenB = lengthAlongPerimeterFromC0(pB, r);
        var EPS = 1e-7;

        // 按周长从 startLen（含）到 endLen（含）顺时针收集角点（返回起点->...->终点）
        function collectCW(startPt, startLen, endPt, endLen) {
          var pts = [{ x: startPt.x, y: startPt.y }];
          // 规范化：将 endLen 映射到 >= startLen 的区间 [startLen, startLen+perim)
          var endLenAdj = endLen;
          if (endLenAdj <= startLen + EPS) endLenAdj += perim;
          // 收集角点：把小于 startLen 的角点视为加 perim
          var cand = [];
          for (var i = 0; i < corners.length; i++) {
            var cl = cornerLens[i];
            var clAdj = cl;
            if (clAdj <= startLen + EPS) clAdj += perim;
            if (clAdj > startLen + EPS && clAdj < endLenAdj - EPS) {
              cand.push({ key: clAdj, pt: corners[i] });
            }
          }
          // 按周长位置排序并加入
          cand.sort(function(a,b){ return a.key - b.key; });
          for (var j = 0; j < cand.length; j++) pts.push({ x: cand[j].pt.x, y: cand[j].pt.y });
          pts.push({ x: endPt.x, y: endPt.y });

          // 特殊处理：若两端都落在同一条边上，保证 pts 中 start->end 的这一段在几何上按边上的自然顺序（避免 y 方向反转）。
          // 检测是否同边
          function detectSide(pt) {
            if (Math.abs(pt.y - r.y) < 1e-6 && pt.x >= r.x - 1e-6 && pt.x <= r.x + r.w + 1e-6) return 'top';
            if (Math.abs(pt.x - (r.x + r.w)) < 1e-6 && pt.y >= r.y - 1e-6 && pt.y <= r.y + r.h + 1e-6) return 'right';
            if (Math.abs(pt.y - (r.y + r.h)) < 1e-6 && pt.x >= r.x - 1e-6 && pt.x <= r.x + r.w + 1e-6) return 'bottom';
            if (Math.abs(pt.x - r.x) < 1e-6 && pt.y >= r.y - 1e-6 && pt.y <= r.y + r.h + 1e-6) return 'left';
            return null;
          }
          var sSide = detectSide(startPt), eSide = detectSide(endPt);
          if (sSide && eSide && sSide === eSide) {
            // 找到 pts 中起始和结束索引（应分别为 0 和 pts.length-1），无需额外角点时直接保持顺序
            // 但若在构造过程中出现了角点（cand.length>0），顺序自然沿周长，无需调整
            if (cand.length === 0) {
              // 两点在同一边且中间无角点：确保从 start 到 end 的顺序与周长方向一致
              // 对于 left 边、top 边等，周长参数化可能与坐标方向相反，下面按 startLen->endLenAdj 确定方向已保证点顺序
              // 因此无需反转 pts；（这里保留占位，若未来需强制按 y/x 比较可在此处理）
            }
          }
          return pts;
        }

        var cw = collectCW(pA, lenA, pB, lenB);
        // CCW 路径：等价于从 B 顺时针到 A，再反转（保证对称）
        var btoa = collectCW(pB, lenB, pA, lenA);
        var ccw = btoa.slice().reverse();
        return { cw: cw, ccw: ccw };
      }

      // ----- 修改：在 routeSampledAlongBoundaries 中选择不交叉的候选路径 -----
      function routeSampledAlongBoundaries(sampled, rects, gap) {
        gap = gap || 0;
        var infos = sampled.map(function (p) {
          return { orig: p, rectIdx: null, proj: null };
        });
        // project points that are inside any rect
        for (var i = 0; i < sampled.length; i++) {
          var pt = sampled[i];
          var cand = candidateRectIdxForPoint(pt);
          var found = null;
          for (var j = 0; j < cand.length; j++) {
            var ri = cand[j],
              r = rects[ri];
            if (!r) continue;
            if (
              pt.x >= r.x &&
              pt.x <= r.x + r.w &&
              pt.y >= r.y &&
              pt.y <= r.y + r.h
            ) {
              found = ri;
              break;
            }
          }
          if (found !== null) {
            var proj = projectPointToRectBoundary(pt, rects[found], gap);
            infos[i].rectIdx = found;
            infos[i].proj = proj;
          }
        }

        var out = [];
        var i = 0;
        while (i < infos.length) {
          if (infos[i].rectIdx === null) {
            out.push(infos[i].orig);
            i++;
            continue;
          }
          // run start..end with same rect
          var ri = infos[i].rectIdx;
          var j = i;
          while (j + 1 < infos.length && infos[j + 1].rectIdx === ri) j++;
          var pA = infos[i].proj;
          var pB = infos[j].proj;
          // get both candidate paths
          var candPaths = buildBoundaryPathsBetween(rects[ri], pA, pB);
          // choose candidate not intersecting current out (prefer shorter)
          var choose = null;
          var cw = candPaths.cw,
            ccw = candPaths.ccw;
          var len = function (arr) {
            var L = 0;
            for (var z = 0; z < arr.length - 1; z++) {
              L += Math.hypot(arr[z + 1].x - arr[z].x, arr[z + 1].y - arr[z].y);
            }
            return L;
          };
          var cwLen = len(cw),
            ccwLen = len(ccw);
          var cwInter = pathIntersectsAny(cw, out);
          var ccwInter = pathIntersectsAny(ccw, out);
          if (!cwInter && !ccwInter) {
            choose = cwLen <= ccwLen ? cw : ccw;
          } else if (!cwInter) {
            choose = cw;
          } else if (!ccwInter) {
            choose = ccw;
          } else {
            // both intersect, fallback to simple projection endpoints to avoid adding crossing
            choose = [
              { x: pA.x, y: pA.y },
              { x: pB.x, y: pB.y },
            ];
          }

          // append choose to out (avoid duplicate point)
          if (out.length > 0) {
            var last = out[out.length - 1];
            if (
              Math.abs(last.x - choose[0].x) < 1e-6 &&
              Math.abs(last.y - choose[0].y) < 1e-6
            ) {
              for (var k = 1; k < choose.length; k++) out.push(choose[k]);
            } else {
              for (var k = 0; k < choose.length; k++) out.push(choose[k]);
            }
          } else {
            for (var k = 0; k < choose.length; k++) out.push(choose[k]);
          }
          i = j + 1;
        }
        // endpoints preservation
        if (sampled.length > 0) {
          out[0] = sampled[0];
          out[out.length - 1] = sampled[sampled.length - 1];
        }
        return out;
      }

      // 插入：按像素步长采样折线为点序列
      function sampleLine(coords, sampleStep) {
        var pts = [];
        for (var i = 0; i < coords.length - 1; i++) {
          var a = coords[i],
            b = coords[i + 1];
          var dx = b.x - a.x,
            dy = b.y - a.y;
          var dist = Math.hypot(dx, dy);
          var steps = Math.max(1, Math.ceil(dist / sampleStep));
          for (var s = 0; s <= steps; s++) {
            var t = s / steps;
            var px = a.x + dx * t;
            var py = a.y + dy * t;
            // 避免连续重复点
            if (
              pts.length &&
              Math.abs(pts[pts.length - 1].x - px) < 1e-6 &&
              Math.abs(pts[pts.length - 1].y - py) < 1e-6
            )
              continue;
            pts.push({ x: px, y: py });
          }
        }
        // 保证包含原始最后一个点
        var last = coords[coords.length - 1];
        var penultimate = pts[pts.length - 1];
        if (
          !penultimate ||
          Math.abs(penultimate.x - last.x) > 1e-6 ||
          Math.abs(penultimate.y - last.y) > 1e-6
        ) {
          pts.push({ x: last.x, y: last.y });
        }
        return pts;
      }

      // 插入：Chaikin 平滑（轻量）用于让贴边路径更自然
      function chaikinSmooth(points, iter) {
        for (var it = 0; it < iter; it++) {
          if (points.length < 3) break;
          var out = [];
          out.push(points[0]);
          for (var i = 0; i < points.length - 1; i++) {
            var p = points[i], q = points[i + 1];
            out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
            out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
          }
          out.push(points[points.length - 1]);
          points = out;
        }
        return points;
      }

      // 新增：Douglas-Peucker 折线简化（保留原序，points: [{x,y},...]，tolerance: 像素）
      function simplifyDouglasPeucker(points, tolerance) {
        if (!points || points.length < 3) return points ? points.slice() : [];
        tolerance = Math.max(0, tolerance || 1);
        var n = points.length;
        var keep = new Array(n).fill(false);
        keep[0] = keep[n - 1] = true;

        function perpDist(p, a, b) {
          var dx = b.x - a.x, dy = b.y - a.y;
          if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
          var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
          var projX = a.x + t * dx, projY = a.y + t * dy;
          return Math.hypot(p.x - projX, p.y - projY);
        }

        function dp(i, j) {
          if (j <= i + 1) return;
          var maxDist = -1, idx = -1;
          for (var k = i + 1; k < j; k++) {
            var d = perpDist(points[k], points[i], points[j]);
            if (d > maxDist) { maxDist = d; idx = k; }
          }
          if (maxDist > tolerance && idx >= 0) {
            keep[idx] = true;
            dp(i, idx);
            dp(idx, j);
          }
        }

        dp(0, n - 1);
        var out = [];
        for (var i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
        return out;
      }

      // ====== 新增：主处理循环（必须在 chaikinSmooth、routeSampledAlongBoundaries、sampleLine 等函数之后） ======
      var sampleStepPx = 6;
      // 确保 window._linePaths 已初始化
      window._linePaths = window._linePaths || [];

      data.features.forEach(function (f) {
        function processLineCoordsArray(coordsArray, strokeWidth) {
          var coordsXY = coordsArray.map(function (c) { return lnglat2xy(c[0], c[1]); });
          var sampled = sampleLine(coordsXY, sampleStepPx);
          var routed = routeSampledAlongBoundaries(sampled, rects, 0); // gap=0 紧贴边框
          if (!routed || routed.length < 2) return;
          // 自适应容差：根据画布尺寸和采样步长设定，避免过度或不足简化
          var tol = Math.max(0.5, Math.min(6, sampleStepPx * 0.8));
          var simplified = simplifyDouglasPeucker(routed, tol);
          // 轻量平滑
          var sm = chaikinSmooth(simplified, 1);
          if (sm && sm.length > 1) {
            var path = new paper.Path({ strokeColor: "blue", strokeWidth: strokeWidth });
            sm.forEach(function (p) { path.add(new paper.Point(p.x, p.y)); });
            window._linePaths.push(path);
          }
        }
        if (f.geometry.type === "LineString") {
          processLineCoordsArray(f.geometry.coordinates, 2);
        } else if (f.geometry.type === "MultiLineString") {
          f.geometry.coordinates.forEach(function (line) {
            processLineCoordsArray(line, 1);
          });
        }
      });

      // 触发重绘
      paper.view.draw();
    })
    .catch((err) => {
      console.error("加载线数据失败", err);
    });
  // 结束点击事件处理函数
});
