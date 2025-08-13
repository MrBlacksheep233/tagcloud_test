// 1. 初始化高德地图
const map = new AMap.Map('mapContainer', {
  zoom: 12,
  center: [114.305215, 30.592935]
});

// 2. 全局变量
let geoDataList = [];         // 多个GeoJSON数据
let currentBbox = [0, 0, 0, 0];  // [minLng,minLat,maxLng,maxLat]
let polygonsOnMap = [];       // 存储地图上的多边形实例
let globalBbox = null;        // 所有GeoJSON全局bbox [minLng,minLat,maxLng,maxLat]

// 3. Paper.js 画布初始化
paper.setup('paperCanvas');

// 3.1 画布平移缩放交互
let isDragging = false;
let lastPoint = null;
let lastCenter = null;
if (paper.view.element) {
  paper.view.element.addEventListener('wheel', function(e) {
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
  }, { passive: false });
}
paper.view.onMouseDown = function(event) {
  isDragging = true;
  lastPoint = event.point;
  lastCenter = paper.view.center;
};
paper.view.onMouseDrag = function(event) {
  if (!isDragging || !lastPoint || !lastCenter) return;
  paper.view.center = lastCenter.subtract(event.point.subtract(lastPoint));
  paper.view.draw();
};
paper.view.onMouseUp = function(event) {
  isDragging = false;
  lastPoint = null;
  lastCenter = null;
};

// 4. 经纬度 → 画布像素（当前bbox映射）
function lngLatToPaper(lng, lat, bbox) {
  if (!bbox) return new paper.Point(0, 0);
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const width = paper.view.size.width;
  const height = paper.view.size.height;
  const x = maxLng - minLng === 0 ? 0 : ((lng - minLng) / (maxLng - minLng)) * width;
  const y = maxLat - minLat === 0 ? 0 : ((maxLat - lat) / (maxLat - minLat)) * height;
  return new paper.Point(x, y);
}

// 5. 地图上绘制多边形
function drawMapPolygons() {
  // 清除旧多边形
  polygonsOnMap.forEach(p => p.setMap(null));
  polygonsOnMap = [];
  if (!geoData) return;
  geoData.features?.forEach(f => {
    const type = f.geometry?.type;
    if (type === 'Polygon' || type === 'MultiPolygon') {
      const rings = type === 'MultiPolygon'
        ? f.geometry.coordinates.flat(1)
        : [f.geometry.coordinates[0]];
      rings.forEach(ring => {
        const polygon = new AMap.Polygon({
          path: ring.map(([lng, lat]) => [lng, lat]),
          fillColor: '#3388ff',
          fillOpacity: 0.3,
          strokeColor: '#3388ff',
          strokeWeight: 1
        });
        polygon.setMap(map);
        polygonsOnMap.push(polygon);
      });
    } else if (type === 'LineString') {
      const line = new AMap.Polyline({
        path: f.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
        strokeColor: '#ff6600',
        strokeWeight: 2
      });
      line.setMap(map);
      polygonsOnMap.push(line);
    } else if (type === 'MultiLineString') {
      f.geometry.coordinates.forEach(lineCoords => {
        const line = new AMap.Polyline({
          path: lineCoords.map(([lng, lat]) => [lng, lat]),
          strokeColor: '#ff6600',
          strokeWeight: 2
        });
        line.setMap(map);
        polygonsOnMap.push(line);
      });
    } else if (type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      const marker = new AMap.Marker({
        position: [lng, lat],
        icon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_rs.png',
        offset: new AMap.Pixel(-13, -30)
      });
      marker.setMap(map);
      polygonsOnMap.push(marker);
    } else if (type === 'MultiPoint') {
      f.geometry.coordinates.forEach(([lng, lat]) => {
        const marker = new AMap.Marker({
          position: [lng, lat],
          icon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_rs.png',
          offset: new AMap.Pixel(-13, -30)
        });
        marker.setMap(map);
        polygonsOnMap.push(marker);
      });
    }
  });
}

// 6. 画布上绘制多边形（全局内容）

// 6.1 画布上绘制面
function drawCanvasPolygons(bbox) {
  geoDataList.forEach(geoData => {
    if (!geoData.features || geoData.features.length === 0) return;
    geoData.features.forEach(f => {
      const geom = f.geometry;
      let label = '';
      if (f.properties) {
        if (f.properties.name != null && f.properties.name !== '') label = String(f.properties.name);
        else if (f.properties.NAME != null && f.properties.NAME !== '') label = String(f.properties.NAME);
      }
      if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        const rings = geom.type === 'MultiPolygon'
          ? geom.coordinates.flat(1)
          : [geom.coordinates[0]];
        rings.forEach(ring => {
          const segs = ring.map(([lng, lat]) => lngLatToPaper(lng, lat, bbox));
          new paper.Path({
            segments: segs,
            closed: true,
            fillColor: '#3388ff33',
            // strokeColor: '#3388ff',
            strokeWidth: 1
          });
          // 标注name字段（重心）
          if (label && segs.length > 2) {
            let cx = 0, cy = 0, area = 0;
            for (let i = 0, j = segs.length - 1; i < segs.length; j = i++) {
              let temp = segs[j].x * segs[i].y - segs[i].x * segs[j].y;
              area += temp;
              cx += (segs[j].x + segs[i].x) * temp;
              cy += (segs[j].y + segs[i].y) * temp;
            }
            area = area / 2;
            if (area !== 0) {
              cx = cx / (6 * area);
              cy = cy / (6 * area);
              new paper.PointText({
                point: new paper.Point(cx, cy),
                content: label,
                fillColor: 'black',
                fontSize: 14,
                fontWeight: 'bold',
                justification: 'center'
              });
            }
          }
        });
      }
    });
  });
}

// 6.2 画布上绘制线
function drawCanvasLines(bbox) {
  geoDataList.forEach(geoData => {
    if (!geoData.features || geoData.features.length === 0) return;
    geoData.features.forEach(f => {
      const geom = f.geometry;
      let label = '';
      if (f.properties) {
        if (f.properties.name != null && f.properties.name !== '') label = String(f.properties.name);
        else if (f.properties.NAME != null && f.properties.NAME !== '') label = String(f.properties.NAME);
      }
      if (geom.type === 'LineString') {
        const segs = geom.coordinates.map(([lng, lat]) => lngLatToPaper(lng, lat, bbox));
        new paper.Path({
          segments: segs,
          closed: false,
          strokeColor: '#0088ffff',
          strokeWidth: 5,
          strokeCap: 'round'
        });
        // 标注name字段（中点）
        if (label && segs.length > 1) {
          let totalLen = 0, segLens = [];
          for (let i = 1; i < segs.length; i++) {
            let len = segs[i].getDistance(segs[i-1]);
            segLens.push(len);
            totalLen += len;
          }
          let halfLen = totalLen / 2, acc = 0, midPt = segs[0];
          for (let i = 1; i < segs.length; i++) {
            if (acc + segLens[i-1] >= halfLen) {
              let remain = halfLen - acc;
              let ratio = remain / segLens[i-1];
              midPt = new paper.Point(
                segs[i-1].x + (segs[i].x - segs[i-1].x) * ratio,
                segs[i-1].y + (segs[i].y - segs[i-1].y) * ratio
              );
              break;
            }
            acc += segLens[i-1];
          }
          new paper.PointText({
            point: midPt,
            content: label,
            fillColor: 'black',
            fontSize: 13,
            fontWeight: 'bold',
            justification: 'center'
          });
        }
      } else if (geom.type === 'MultiLineString') {
        geom.coordinates.forEach(lineCoords => {
          const segs = lineCoords.map(([lng, lat]) => lngLatToPaper(lng, lat, bbox));
          new paper.Path({
            segments: segs,
            closed: false,
            strokeColor: '#0088ffff',
            strokeWidth: 5,
            strokeCap: 'round'
          });
          // 标注name字段（中点）
          if (label && segs.length > 1) {
            let totalLen = 0, segLens = [];
            for (let i = 1; i < segs.length; i++) {
              let len = segs[i].getDistance(segs[i-1]);
              segLens.push(len);
              totalLen += len;
            }
            let halfLen = totalLen / 2, acc = 0, midPt = segs[0];
            for (let i = 1; i < segs.length; i++) {
              if (acc + segLens[i-1] >= halfLen) {
                let remain = halfLen - acc;
                let ratio = remain / segLens[i-1];
                midPt = new paper.Point(
                  segs[i-1].x + (segs[i].x - segs[i-1].x) * ratio,
                  segs[i-1].y + (segs[i].y - segs[i-1].y) * ratio
                );
                break;
              }
              acc += segLens[i-1];
            }
            new paper.PointText({
              point: midPt,
              content: label,
              fillColor: 'black',
              fontSize: 13,
              fontWeight: 'bold',
              justification: 'center'
            });
          }
        });
      }
    });
  });
}

// 6.3 画布上绘制点（文本标签）
function drawCanvasPoints(bbox) {
  // 收集所有面（多边形）像素路径
  const allPolygons = [];
  geoDataList.forEach(geoData => {
    if (!geoData.features) return;
    geoData.features.forEach(f => {
      const geom = f.geometry;
      if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        const rings = geom.type === 'MultiPolygon' ? geom.coordinates.flat(1) : [geom.coordinates[0]];
        rings.forEach(ring => {
          const segs = ring.map(([lng, lat]) => lngLatToPaper(lng, lat, bbox));
          allPolygons.push(segs);
        });
      }
    });
  });

  // 判断矩形与多边形是否有交集（粗略：包围盒重叠+精确：点在多边形内）
  function rectPolygonOverlap(rect, polygon) {
    // 粗略：包围盒不重叠直接返回false
    let minX = Math.min(...polygon.map(p=>p.x)), maxX = Math.max(...polygon.map(p=>p.x));
    let minY = Math.min(...polygon.map(p=>p.y)), maxY = Math.max(...polygon.map(p=>p.y));
    if (rect.x + rect.w <= minX || rect.x >= maxX || rect.y + rect.h <= minY || rect.y >= maxY) return false;
    // 精确：标签四角有任意点在多边形内，或多边形顶点在标签内
    const corners = [
      {x:rect.x, y:rect.y},
      {x:rect.x+rect.w, y:rect.y},
      {x:rect.x, y:rect.y+rect.h},
      {x:rect.x+rect.w, y:rect.y+rect.h}
    ];
    for (let pt of corners) {
      if (pointInPolygon(pt, polygon)) return true;
    }
    for (let pt of polygon) {
      if (pt.x >= rect.x && pt.x <= rect.x+rect.w && pt.y >= rect.y && pt.y <= rect.y+rect.h) return true;
    }
    return false;
  }
  // 射线法判断点是否在多边形内
  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-10) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  // 辅助：点到线段距离和最近点
  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    if (dx === 0 && dy === 0) return { dist: Math.hypot(px - x1, py - y1), nx: x1, ny: y1 };
    let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    const nx = x1 + t * dx, ny = y1 + t * dy;
    return { dist: Math.hypot(px - nx, py - ny), nx, ny };
  }
  // 简单避让：记录已用label区域，若重叠则向上偏移
  const labelBoxes = [];
  const LABEL_HEIGHT = 16; // 适当加大高度以适应字体
  // 以当前bbox中心为全局标签云中心
  let bboxCenter = new paper.Point(
    (paper.view.size.width) / 2,
    (paper.view.size.height) / 2
  );
  // 收集所有线段（包括多边形边界和折线）
  const allLines = [];
  geoDataList.forEach(geoData => {
    if (!geoData.features) return;
    geoData.features.forEach(f => {
      const geom = f.geometry;
      if (geom.type === 'LineString') {
        const segs = geom.coordinates.map(([lng, lat]) => lngLatToPaper(lng, lat, bbox));
        for (let i = 1; i < segs.length; i++) {
          allLines.push([segs[i-1], segs[i]]);
        }
      } else if (geom.type === 'MultiLineString') {
        geom.coordinates.forEach(lineCoords => {
          const segs = lineCoords.map(([lng, lat]) => lngLatToPaper(lng, lat, bbox));
          for (let i = 1; i < segs.length; i++) {
            allLines.push([segs[i-1], segs[i]]);
          }
        });
      } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        const rings = geom.type === 'MultiPolygon' ? geom.coordinates.flat(1) : [geom.coordinates[0]];
        rings.forEach(ring => {
          const segs = ring.map(([lng, lat]) => lngLatToPaper(lng, lat, bbox));
          for (let i = 1; i < segs.length; i++) {
            allLines.push([segs[i-1], segs[i]]);
          }
          // 闭合边
          if (segs.length > 2) {
            allLines.push([segs[segs.length-1], segs[0]]);
          }
        });
      }
    });
  });

  // 辅助：判断矩形与线段是否相交
  function rectLineIntersect(rect, p1, p2) {
    // 四条边
    const rectLines = [
      [{x:rect.x, y:rect.y}, {x:rect.x+rect.w, y:rect.y}],
      [{x:rect.x+rect.w, y:rect.y}, {x:rect.x+rect.w, y:rect.y+rect.h}],
      [{x:rect.x+rect.w, y:rect.y+rect.h}, {x:rect.x, y:rect.y+rect.h}],
      [{x:rect.x, y:rect.y+rect.h}, {x:rect.x, y:rect.y}]
    ];
    for (let i=0;i<4;i++) {
      if (segmentsIntersect(rectLines[i][0], rectLines[i][1], p1, p2)) return true;
    }
    return false;
  }
  // 线段相交
  function segmentsIntersect(a, b, c, d) {
    function ccw(p1, p2, p3) {
      return (p3.y-p1.y)*(p2.x-p1.x) > (p2.y-p1.y)*(p3.x-p1.x);
    }
    return (ccw(a,c,d) !== ccw(b,c,d)) && (ccw(a,b,c) !== ccw(a,b,d));
  }
  // 判断点是否在当前bbox范围内
  function isLngLatInBbox(lng, lat, bbox) {
    if (!bbox) return false;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
  }
  // 1. 收集当前范围内所有点及标签
  let pointLabels = [];
  geoDataList.forEach(geoData => {
    if (!geoData.features || geoData.features.length === 0) return;
    geoData.features.forEach(f => {
      const geom = f.geometry;
      if (geom.type === 'Point') {
        const [lng, lat] = geom.coordinates;
        if (!isLngLatInBbox(lng, lat, bbox)) return;
        let pt = lngLatToPaper(lng, lat, bbox);
        let label = '';
        if (f.properties) {
          label = f.properties.name || f.properties.NAME || '';
        }
        if (label) {
          pointLabels.push({pt, label, fontSize: 16});
        }
      } else if (geom.type === 'MultiPoint') {
        geom.coordinates.forEach(([lng, lat], idx) => {
          if (!isLngLatInBbox(lng, lat, bbox)) return;
          let pt = lngLatToPaper(lng, lat, bbox);
          let label = '';
          if (f.properties) {
            if (Array.isArray(f.properties.name)) {
              label = f.properties.name[idx] || '';
            } else if (Array.isArray(f.properties.NAME)) {
              label = f.properties.NAME[idx] || '';
            } else {
              label = f.properties.name || f.properties.NAME || '';
            }
          }
          if (label) {
            pointLabels.push({pt, label, fontSize: 12});
          }
        });
      }
    });
  });
  // 2. 按距离中心点从近到远排序
  pointLabels.sort((a, b) => a.pt.getDistance(bboxCenter) - b.pt.getDistance(bboxCenter));
  // 3. 依次让每个点标签优先尝试中心点，若冲突则螺旋外扩，严格不重叠且避让线面
  // 空间索引加速重叠检测，减少尝试次数，步长自适应
  // 简单网格索引（仅用于加速标签重叠检测）
  const gridSize = 32;
  const grid = {};
  function getGridKeys(box) {
    const keys = [];
    const x0 = Math.floor(box.x / gridSize), x1 = Math.floor((box.x + box.w) / gridSize);
    const y0 = Math.floor(box.y / gridSize), y1 = Math.floor((box.y + box.h) / gridSize);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        keys.push(gx + ',' + gy);
      }
    }
    return keys;
  }
  function fastOverlap(box) {
    const keys = getGridKeys(box);
    for (let k of keys) {
      if (!grid[k]) continue;
      for (let b of grid[k]) {
        if (!(box.x + box.w <= b.x || box.x >= b.x + b.w || box.y + box.h <= b.y || box.y >= b.y + b.h)) {
          return true;
        }
      }
    }
    return false;
  }
  function addToGrid(box) {
    const keys = getGridKeys(box);
    for (let k of keys) {
      if (!grid[k]) grid[k] = [];
      grid[k].push(box);
    }
  }
  // 先将中心位置标签的 box 加入 labelBoxes 和 grid，防止重叠
  let centerLabelBox = null;
  if (bboxCenter) {
    let centerLabel = '中心位置';
    let tempText = new paper.PointText({
      point: new paper.Point(-1000, -1000),
      content: centerLabel,
      fontSize: 18,
      fontWeight: 'bold',
      visible: false
    });
    let labelWidth = tempText.bounds.width + 8;
    tempText.remove();
    centerLabelBox = {
      x: bboxCenter.x - labelWidth/2,
      y: bboxCenter.y - LABEL_HEIGHT/2,
      w: labelWidth,
      h: LABEL_HEIGHT
    };
    labelBoxes.push(centerLabelBox);
    addToGrid(centerLabelBox);
  }

  // 动态缩放标签距离和字体，防止缩小时标签大幅偏移和重叠
  const minViewSize = 300;
  const scale = Math.max(0.5, Math.min(1, Math.min(paper.view.size.width, paper.view.size.height) / minViewSize));
  pointLabels.forEach(({pt, label, fontSize}) => {
    let tempText = new paper.PointText({
      point: new paper.Point(-1000, -1000),
      content: label,
      fontSize: fontSize * scale,
      fontWeight: 'bold',
      visible: false
    });
    let labelWidth = tempText.bounds.width + 8;
    tempText.remove();
    let found = false, box, xOffset = 0, yOffset = 0;
    // 默认锚定在点本身
    let cx = pt.x;
    let cy = pt.y;
    box = {
      x: cx - labelWidth/2,
      y: cy - LABEL_HEIGHT/2 * scale,
      w: labelWidth,
      h: LABEL_HEIGHT * scale
    };
    // 只检测与其他标签、线、面重叠，不检测与原始点本身重叠
    let overlap = fastOverlap(box); // 只检测已放置的标签
    let lineOverlap = allLines.some(([p1, p2]) => rectLineIntersect(box, p1, p2));
    let polyOverlap = allPolygons.some(poly => rectPolygonOverlap(box, poly));
    if (!overlap && !lineOverlap && !polyOverlap) {
      found = true;
      xOffset = 0;
      yOffset = 0;
    }
    // 若重叠则螺旋避让
    if (!found) {
      const spiralStep = Math.max(2, Math.floor(labelWidth / 4));
      const spiralMaxRadius = 1000 * scale;
      let tryCount = 0, maxTry = 200;
      let anchorAngle = Math.PI / 4; // 右上45°
      let anchorDist = Math.max(5, labelWidth * 0.5 * scale);
      for (let r = anchorDist; r <= spiralMaxRadius && !found && tryCount < maxTry; r += spiralStep) {
        for (let a = 0; a < 360 && !found; a += 30) {
          let theta = anchorAngle + a * Math.PI / 180;
          let cx2 = pt.x + r * Math.cos(theta);
          let cy2 = pt.y + r * Math.sin(theta);
          box = {
            x: cx2 - labelWidth/2,
            y: cy2 - LABEL_HEIGHT/2 * scale,
            w: labelWidth,
            h: LABEL_HEIGHT * scale
          };
          let overlap2 = fastOverlap(box);
          let lineOverlap2 = allLines.some(([p1, p2]) => rectLineIntersect(box, p1, p2));
          let polyOverlap2 = allPolygons.some(poly => rectPolygonOverlap(box, poly));
          tryCount++;
          if (!overlap2 && !lineOverlap2 && !polyOverlap2) {
            found = true;
            xOffset = cx2 - pt.x;
            yOffset = cy2 - pt.y;
            break;
          }
        }
      }
    }
    if (!found) {
      xOffset = 0;
      yOffset = 0;
      box = {
        x: pt.x - labelWidth/2,
        y: pt.y - LABEL_HEIGHT/2 * scale,
        w: labelWidth,
        h: LABEL_HEIGHT * scale
      };
    }
    labelBoxes.push(box);
    addToGrid(box);
    new paper.PointText({
      point: new paper.Point(pt.x + xOffset, pt.y + yOffset),
      content: label,
      fillColor: '#ff3333',
      fontSize: fontSize * scale,
      fontWeight: 'bold',
      justification: 'center'
    });
  });
  // 在中心位置添加“中心位置”黑色标签
  if (bboxCenter) {
    new paper.PointText({
      point: bboxCenter,
      content: '中心位置',
      fillColor: 'black',
      fontSize: 18,
      fontWeight: 'bold',
      justification: 'center'
    });
  }
}

// 6.4 主调度函数
function drawCanvasFeatures(bbox) {
  paper.project.clear();
  drawCanvasPolygons(bbox);
  drawCanvasLines(bbox);
  drawCanvasPoints(bbox);
  paper.view.zoom = 1;
  paper.view.center = new paper.Point(paper.view.size.width/2, paper.view.size.height/2);
  paper.view.draw();
}

// 7. 实时获取地图 bbox 并重绘，并同步画布视图
function updateBboxAndRedraw() {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  currentBbox = [sw.lng, sw.lat, ne.lng, ne.lat];
  drawCanvasFeatures(currentBbox);
}

// 8. 事件监听
// map.on('complete moveend zoomend', updateBboxAndRedraw); // 注释掉自动同步

// 8.1 按钮手动同步
window.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('syncBboxBtn');
  if (btn) {
    btn.onclick = updateBboxAndRedraw;
  }
});

 
// 9. 加载单个GeoJSON并加入geoDataList
function loadGeoJSONAndInit(filePath, callback) {
  fetch(filePath)
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      geoDataList.push(data);
      if (typeof callback === 'function') callback(data);
    })
    .catch(e => console.error('GeoJSON 加载失败:', e));
}

// 9.1 计算所有GeoJSON的全局bbox
function computeGlobalBbox() {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  geoDataList.forEach(data => {
    data.features?.forEach(f => {
      const geom = f.geometry;
      if (!['Polygon', 'MultiPolygon'].includes(geom.type)) return;
      const rings = geom.type === 'MultiPolygon' ? geom.coordinates.flat(1) : [geom.coordinates[0]];
      rings.forEach(ring => {
        ring.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        });
      });
    });
  });
  globalBbox = [minLng, minLat, maxLng, maxLat];
}

// 10. 启动：加载多个GeoJSON文件
const geojsonFiles = [
  './data/武汉市街道级点数据.json',
  './data/长江线化(武汉).geojson',
  './data/朱家河线化.geojson',
  './data/滠水线化.geojson',
  './data/汉江线化.geojson',
  './data/东湖等积圆.geojson', 
  './data/沙湖等积圆.geojson',
  './data/汤逊湖等积圆.geojson',
  './data/梁子湖等积圆.geojson',
  './data/金银湖等积圆.geojson',
  './data/严西湖等积圆.geojson',
];
let loadedCount = 0;
geojsonFiles.forEach(file => {
  loadGeoJSONAndInit(file, () => {
    loadedCount++;
    if (loadedCount === geojsonFiles.length) {
      computeGlobalBbox();
      drawCanvasFeatures(globalBbox); // 首次全局内容
      updateBboxAndRedraw(); // 首次同步视窗
    }
  });
});



