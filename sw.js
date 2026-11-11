const CACHE='fm-pwa-v3';
const ASSETS=['./','index.html','style.css','app.js','manifest.json','icon-192.png','icon-512.png'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS))
    .then(()=>self.skipWaiting())
));
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  const req=e.request;
  const url=new URL(req.url);
  // 只处理本站 GET 请求，跨域音频等直接放行
  if(req.method!=='GET' || url.origin!==location.origin) return;

  // 页面导航：网络优先，保证能拿到最新 HTML；离线时回退缓存
  if(req.mode==='navigate'){
    e.respondWith(
      fetch(req).then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(req,copy));
        return r;
      }).catch(()=>caches.match(req).then(r=>r||caches.match('index.html')))
    );
    return;
  }

  // 静态资源：缓存优先，同时后台更新
  e.respondWith(caches.match(req).then(r=>{
    const net=fetch(req).then(res=>{
      const copy=res.clone();
      caches.open(CACHE).then(c=>c.put(req,copy));
      return res;
    }).catch(()=>r);
    return r||net;
  }));
});
