/* Маскот Newi: пиксельный дрон. Выражения глаз — как в наборе состояний проекта Newi. */
window.Mascot=(function(){
  const C="#22d3ee",S="#2b3a54";
  const eyes={
    happy:dx=>`<rect x="${540+dx}" y="520" width="40" height="40" fill="${C}"/><rect x="${500+dx}" y="560" width="40" height="40" fill="${C}"/><rect x="${580+dx}" y="560" width="40" height="40" fill="${C}"/><rect x="${540+dx}" y="545" width="40" height="15" fill="#1799ad"/>`,
    blink:dx=>`<rect x="${500+dx}" y="570" width="120" height="20" fill="${C}"/>`,
    think:dx=>`<rect x="${500+dx}" y="520" width="90" height="80" fill="${C}"/><rect x="${535+dx}" y="550" width="20" height="20" fill="#06101c"/>`,
    alert:dx=>`<rect x="${545+dx}" y="500" width="30" height="85" fill="${C}"/><rect x="${545+dx}" y="610" width="30" height="35" fill="${C}"/>`,
    sleepy:dx=>`<rect x="${500+dx}" y="545" width="120" height="25" fill="${C}"/><rect x="${500+dx}" y="545" width="25" height="55" fill="${C}"/><rect x="${595+dx}" y="545" width="25" height="55" fill="${C}"/>`,
    sad:dx=>`<rect x="${500+dx}" y="540" width="120" height="25" fill="${C}"/><rect x="${520+dx}" y="565" width="80" height="25" fill="${C}"/><rect x="${545+dx}" y="590" width="30" height="25" fill="${C}"/>`,
    speak:dx=>`<rect x="${500+dx}" y="520" width="120" height="25" fill="#22d3ee"/><rect x="${545+dx}" y="545" width="30" height="75" fill="#22d3ee"/><rect x="${500+dx}" y="620" width="120" height="25" fill="#22d3ee"/>`
  };
  function svg(face){
    face=face||"happy";const e=`<g>${eyes[face](0)}${eyes[face](160)}</g>`,sp=face==="speak",fr=sp?"#2bb8ff":"#1a2645",led=sp?"#67e8f9":"#f43f5e";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="70 80 1080 1090" shape-rendering="crispEdges"><style>.f{animation:f .6s ease-in-out infinite alternate}@keyframes f{from{opacity:.7}to{opacity:1}}</style><g>
<ellipse cx="640" cy="1080" rx="170" ry="70" fill="#22d3ee" opacity=".10"/><ellipse cx="640" cy="1075" rx="105" ry="46" fill="#22d3ee" opacity=".18"/>
<g stroke="${S}" stroke-width="10"><rect x="160" y="300" width="200" height="140" fill="#66758f"/><rect x="100" y="460" width="150" height="160" fill="#7a88a8"/><rect x="140" y="660" width="110" height="140" fill="#44546a"/>
<rect x="920" y="260" width="200" height="160" fill="#7a88a8"/><rect x="860" y="285" width="70" height="75" fill="#66708a"/><rect x="330" y="235" width="80" height="90" fill="#4a5a7a" transform="rotate(-10 370 280)"/></g>
<rect x="240" y="360" width="190" height="480" fill="#8d9db6"/><rect x="240" y="360" width="190" height="80" fill="#a4b2cc"/><rect x="240" y="380" width="20" height="440" fill="#c5d3e8"/><rect x="260" y="760" width="170" height="60" fill="#44546a"/>
<rect x="850" y="360" width="190" height="480" fill="#8d9db6"/><rect x="850" y="360" width="190" height="80" fill="#c5d3e8"/><rect x="1020" y="380" width="20" height="460" fill="#2f3e55"/><rect x="850" y="760" width="170" height="60" fill="#44546a"/>
<rect x="420" y="380" width="440" height="440" fill="${fr}"/><rect x="445" y="405" width="390" height="390" fill="#060a14"/>
${[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(i=>`<rect x="445" y="${425+i*19}" width="390" height="5" fill="#0b1426"/>`).join("")}
${e}
<circle cx="765" cy="475" r="50" fill="#5a1c30"/><circle cx="765" cy="475" r="30" fill="${led}"/>
<g><rect x="720" y="320" width="160" height="80" fill="#66758f"/><rect x="860" y="320" width="20" height="80" fill="#22304a"/><rect x="730" y="220" width="120" height="100" fill="#8d9db6"/><rect x="750" y="120" width="100" height="100" fill="#a4b2cc"/><rect x="750" y="120" width="100" height="20" fill="#dbe5f3"/><rect x="830" y="140" width="20" height="80" fill="#4b5a74"/></g>
<g transform="rotate(-14 470 410)"><rect x="385" y="320" width="170" height="90" fill="#66758f"/><rect x="535" y="320" width="20" height="90" fill="#22304a"/><rect x="395" y="225" width="130" height="95" fill="#8d9db6"/><rect x="405" y="125" width="100" height="100" fill="#a4b2cc"/><rect x="405" y="125" width="100" height="20" fill="#dbe5f3"/><rect x="485" y="145" width="20" height="80" fill="#4b5a74"/></g>
<rect x="560" y="975" width="160" height="60" fill="#475569" stroke="#1e293b" stroke-width="10"/><rect class="f" x="590" y="1040" width="100" height="80" fill="#22d3ee"/></g></svg>`;
  }
  let face="happy",idleT=null,faceT=null;
  const cache={};
  const uri=f=>cache[f]||(cache[f]="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg(f)));
  function set(f){face=f;document.querySelectorAll("img.mascot").forEach(i=>{i.src=uri(f);i.dataset.face=f})}
  function mount(){document.querySelectorAll("[data-mascot]").forEach(h=>{if(!h.firstChild){const i=new Image();i.className="mascot";i.alt="";i.decoding="async";i.src=uri(face);i.dataset.face=face;h.append(i)}})}
  /** Кратко показать выражение и вернуться к спокойному. */
  function flash(f,ms){set(f);clearTimeout(faceT);faceT=setTimeout(()=>set("happy"),ms||1500)}
  function wake(){clearTimeout(idleT);if(face==="sleepy")set("happy");idleT=setTimeout(()=>{if(face==="happy")set("sleepy")},60000)}
  setInterval(()=>{if(face==="happy"){set("blink");setTimeout(()=>{if(face==="blink")set("happy")},140)}},4200);
  return {svg,mount,set,flash,wake,get face(){return face}};
})();
