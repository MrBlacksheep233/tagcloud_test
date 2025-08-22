// 初始化高德地图
const map = new AMap.Map('mapContainer', {
  zoom: 13,
  center: [114.305215, 30.592935]
});


// Paper.js 画布初始化
paper.setup('paperCanvas');

// 画布平移缩放交互
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

  // 同步画布到地图bbox并在中心生成标签
  document.getElementById('syncBboxBtn').addEventListener('click', function() {
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
      content: '中心位置',
      fillColor: 'black',
      fontSize: 16,
      justification: 'center'
    });
    window._centerTag = text;

    // 加载点数据并显示标签
    fetch('data/武汉市街道级点数据.json')
      .then(res => res.json())
      .then(data => {
        // 获取地图范围
        var bounds = map.getBounds();
        var sw = bounds.getSouthWest();
        var ne = bounds.getNorthEast();
        var minLng = sw.getLng();
        var maxLng = ne.getLng();
        var minLat = sw.getLat();
        var maxLat = ne.getLat();
        var canvas = document.getElementById('paperCanvas');
        // 画布中心
        var centerLng = center.getLng();
        var centerLat = center.getLat();
        function lnglat2xy(lng, lat) {
          var x = ((lng - minLng) / (maxLng - minLng)) * canvas.width;
          var y = canvas.height - ((lat - minLat) / (maxLat - minLat)) * canvas.height;
          return {x, y};
        }
        var centerXY = lnglat2xy(centerLng, centerLat);
        // 清除旧点标签
        if (window._pointTags) window._pointTags.forEach(t => t.remove());
        window._pointTags = [];
        // 筛选范围内的点
        var features = data.features.filter(f => {
          var coords = f.geometry.coordinates;
          var lng = coords[0];
          var lat = coords[1];
          return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
        });
        // 计算距离和角度
        var tagList = features.map(f => {
          var coords = f.geometry.coordinates;
          var xy = lnglat2xy(coords[0], coords[1]);
          var dx = xy.x - centerXY.x;
          var dy = xy.y - centerXY.y;
          var r = Math.sqrt(dx*dx + dy*dy);
          var phi = Math.atan2(dy, dx);
          return {
            name: f.properties.NAME || '',
            r, phi
          };
        });
        // 按 r 升序排序
        tagList.sort((a, b) => a.r - b.r);
        // 统计 rmin, rmax
        var rmin = tagList.length ? tagList[0].r : 0;
        var rmax = tagList.length ? tagList[tagList.length-1].r : 1;
        var h = canvas.height;
        var centerPoint = paper.view.center;
        // 摆放标签（带优化碰撞检测和径向移位，中心标签也参与检测）
        var placedTags = [];
        placedTags.push(text); // 中心标签参与检测

        function rotateAroundCenter(cx, cy, x, y, angleDeg) {
          var angle = angleDeg * Math.PI / 180;
          var dx = x - cx, dy = y - cy;
          var cos = Math.cos(angle), sin = Math.sin(angle);
          return {
            x: cx + cos * dx - sin * dy,
            y: cy + sin * dx + cos * dy
          };
        }

        tagList.forEach((tag, i) => {
          var Ri = (rmax === rmin) ? 0 : ((tag.r - rmin) / (rmax - rmin)) * h * 0.25;
          var maxRadius = h * 0.25;
          var step = 20;
          var centerX = centerPoint.x, centerY = centerPoint.y;
          var baseX = centerX + Ri * Math.cos(tag.phi);
          var baseY = centerY + Ri * Math.sin(tag.phi);

          // 多角度尝试
          var angles = [-15, -10, -5, 0, 5, 10, 15];
          var found = false, pt;
          for (var radiusTry = 0; radiusTry < Math.ceil(maxRadius/step); radiusTry++) {
            for (var a = 0; a < angles.length; a++) {
              var pos = rotateAroundCenter(centerX, centerY, baseX, baseY, angles[a]);
              pt = new paper.PointText({
                point: [pos.x, pos.y],
                content: tag.name,
                fillColor: 'blue',
                fontSize: 12,
                justification: 'center'
              });
              // 检查碰撞
              var overlapped = placedTags.some(other => {
                if (!pt.bounds || !other.bounds) return false;
                return pt.bounds.intersects(other.bounds);
              });
              if (!overlapped) {
                found = true;
                break;
              } else {
                pt.remove();
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
      });
  });
  
