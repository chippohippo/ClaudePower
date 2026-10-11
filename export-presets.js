// Re-export presets.json from the tuner HTML. Usage: node export-presets.js <path-to-aim_config_tuner.html>
const fs=require('fs');const src=process.argv[2]||'tuner.html';
const s=fs.readFileSync(src,'utf8');
const code=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
const store={};const mk=()=>({_v:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},children:[],attributes:{},get value(){return this._v},set value(v){this._v=v},set innerHTML(h){this._h=h},get innerHTML(){return this._h||''},set textContent(t){this._t=t},get textContent(){return this._t||''},addEventListener(){},removeEventListener(){},appendChild(){},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]??null},querySelector(){return mk()},querySelectorAll(){return[]},closest(){return null},focus(){},click(){},remove(){}});
const ls={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}};
global.localStorage=ls;global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),location:{href:''},localStorage:ls};
const c={};global.document={getElementById:id=>c[id]||(c[id]=mk()),querySelector:()=>mk(),querySelectorAll:()=>[],createElement:()=>mk(),addEventListener(){},body:mk(),documentElement:mk()};
global.navigator={clipboard:{writeText:async()=>{}},userAgent:'node'};global.requestAnimationFrame=f=>f(0);global.alert=()=>{};global.fetch=async()=>({ok:false});
const ctx={};new Function('with(this){'+code+'}\nthis.A={PRESETS,GAMES,RES};').call(ctx);
const strip=h=>h.replace(/<[^>]+>/g,'').replace(/&rarr;/g,'→').replace(/&deg;/g,'°').replace(/&rsquo;/g,'’').replace(/&mdash;/g,'—').replace(/&ndash;/g,'–').replace(/&times;/g,'×').replace(/&nbsp;/g,' ').replace(/&minus;/g,'−').replace(/&sup2;/g,'²').replace(/&ldquo;/g,'“').replace(/&rdquo;/g,'”').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');
const out={schema:1,generated:new Date().toISOString().slice(0,10),tablet:{name:'Wacom DTC-141',reportHz:360,unitMm:0.01,widthMm:310},
 games:ctx.A.GAMES.map(g=>({id:g.id,name:g.name,K:g.K,fovMin:g.fovMin,fovMax:g.fovMax,fovLocked:!!g.fovLocked,fov3rd:!!g.fov3rd,fovEstimated:!!g.fovEstimated,maxW:g.maxW,note:strip(g.note||'')})),
 monitors:ctx.A.RES,
 presets:ctx.A.PRESETS.map(p=>({id:p.id,name:p.name,group:p.group,tag:p.tag,field:p.field||null,desc:strip(p.desc),pxmm:p.pxmm,cm:p.cm,snap:p.snap,hdlMax:p.hdlMax,slider:p.slider,res:p.res,adv:p.adv||{},lut:p.lut||null,cohOv:p.cohOv||null,radialOv:p.radialOv||null,
  // 3.1: explicit filter plan, DERIVED from the authored state (single write path preserved)
  filters:(c=>{
    const list=[{id:'Hover_Distance_Limiter',on:true,settings:{Hover_max:p.hdlMax}}];
    if(c)list.push({id:'CoherenceStabilizerTabletSpace',on:true,settings:{
      TremorWindowMs:c.window,HoldTimeMs:c.hold,FullPassSpeed:c.fullPass,EngageSpeed:c.engage,
      CoherenceFloor:c.floor,CoherenceCeiling:c.ceiling,RailStrength:c.rails,AnchorStrength:c.anchor,
      AnchorTimeMs:c.anchorMs,SettleAssist:c.settle,SettleFlickSpeed:c.settleSpeed,
      TapAnchor:c.tap,TapArmPressurePct:c.tapArm,TapHoldMs:c.tapHold,TapBreakMm:c.tapBreak,
      LeadMs:c.lead,LeadMaxMm:c.leadMax==null?1.5:c.leadMax}});
    // session 3: the game personality filters, authored per family + role
    const G={'The Baseline':'cod','Marvel Rivals':'rivals','The Finals':'finals','Apex Legends':'apex',
             'Overwatch 2':'ow2','Holdfast: NAW':'holdfast','Valorant':'val',
             'Specific Characters — Marvel Rivals':'rivals','Specific Characters — Overwatch 2':'ow2',
             'Helldivers 2':'hd2','Deadlock':'deadlock'};   // hd2 has no personality filter (no cls below) - mapped so policy and pins know the game
    const game=p.group.indexOf('Breakpoint')===0?'cod':G[p.group];
    if(game){
      const isLab=['Slipstream','Stillframe','Flatline','Guardrail','Surgeon','Protocol','Cannonade'].some(n=>p.name.indexOf(n)>=0);
      const planted=p.name.indexOf('Planted')>=0||p.id==='breakslow';
      const lm={FloorUntilMmS:15,TapUntilMmS:55,TrackUntilMmS:150};
      const M={cod:{RailStrength:planted?0.2:0.35,VerticalOnly:1,SnapDeg:p.snap},
               val:{MaxDzMm:0.45,KneeMmS:8,FlushOnTurnDeg:60},
               apex:{MaxDzMm:0.35,KneeMmS:10,TrackGlue:0.15,AntiTrailTurnDeg:25},
               ow2:{ModeHybrid:1,RailStrength:0.25,RailCeilMmS:18,SnapDeg:p.snap},
               rivals:{MaxDzMm:0.4,KneeMmS:10,TrackGlue:0.12,AntiTrailTurnDeg:20,IgnoreSnap:1},
               finals:{BrakeDropFrac:0.45,BrakeWindowMs:40,BrakeGain:0.55,BrakeHoldReports:2},
               holdfast:{ContactOnly:0}}[game];
      const cls={cod:'CodMaster',val:'ValMaster',apex:'ApexMaster',ow2:'Ow2Master',
                 rivals:'RivalsMaster',finals:'FinalsMaster',holdfast:'HoldfastMaster'}[game];
      // rivpsy (2026-09-14): the Psylocke lab measured the Rivals Master filter 56% worse on flyers - its
      // anti-trail re-anchor injects position jumps the curve accelerates - so that card ships filterless (T0).
      // 2026-09-15: character cards carry the hero lab's own verdict as gameFilter:false|true.
      const noGameFilter = p.id==='rivpsy' || p.gameFilter===false;
      // 2026-09-16 audit: RETIRED. Measured through the shipping filter code, the Valorant / Apex / Rivals rest deadzone
      // erased micro-aim (a 0.12 mm correction delivered 3-7%, a slow creep took 139 ms to register) - relative output
      // cannot tell a slow intentional correction from tremor inside a 0.35-0.45 mm gate. No field verdict ever backed
      // them. The entries stay in the plan, OFF, so the retirement is visible and reversible.
      const retiredGameFilter = game==='val'||game==='apex'||game==='rivals';
      if(cls)list.push({id:'AimForge.Filters.'+cls,on:!isLab&&!noGameFilter&&!retiredGameFilter,settings:Object.assign({},M,lm)});
      // CodLab (T3 hold-assist EMA) is authored OFF everywhere as of 2026-08-29: it was ON for
      // Slow Center and is the likeliest source of the field-reported "high latency feeling".
      if(game==='cod')list.push({id:'AimForge.Filters.CodLab',on:false,settings:Object.assign({HoldAssistMs:120},lm)});
      if(game==='val')list.push({id:'AimForge.Filters.ValLab',on:p.name.indexOf('Planted')>=0,settings:Object.assign({EmaAmount:0.05},lm)});
      if(game==='ow2')list.push({id:'AimForge.Filters.Ow2Lab',on:p.name.indexOf('Guardrail')>=0,settings:Object.assign({RailStrength:0.5,OrthoCapMm:0.15},lm)});
    }
    return list;
  })(p.cohOv)}))};
fs.writeFileSync('presets.json',JSON.stringify(out,null,2));
console.log('presets.json:',out.presets.length,'presets');
