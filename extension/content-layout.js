/* Geometry-only conversation layout. Never reads message text, inputs or files. */
(function(root){
  'use strict';
  const COLUMN_ATTR='data-cgww-content-column';
  const STYLE_ID='cgww-content-layout';
  const GUTTER=12;
  function pixels(value){
    if(typeof value!=='string'||!/^\d+(?:\.\d+)?px$/.test(value.trim()))return null;
    const n=Number.parseFloat(value);return Number.isFinite(n)?n:null;
  }
  function number(value){return pixels(value)||0;}
  function columnGeometry(style,compact=false){
    const max=pixels(style.maxWidth);
    if(max===null||max<400||max>1400)return null;
    const left=number(style.paddingLeft),right=number(style.paddingRight);
    const border=number(style.borderLeftWidth)+number(style.borderRightWidth);
    const contentMax=max-(style.boxSizing==='border-box'?left+right+border:0);
    if(contentMax<320)return null;
    const paddingLeft=compact?Math.min(left,GUTTER):left;
    const paddingRight=compact?Math.min(right,GUTTER):right;
    return {contentMax,paddingLeft,paddingRight,border,
      columnMax:contentMax+paddingLeft+paddingRight+border};
  }
  function requiredOuterWidth(columnMax,ancestorInsets,scrollbar,frameBorder=2){
    return Math.min(1400,Math.max(320,Math.ceil(columnMax+ancestorInsets+scrollbar+frameBorder)));
  }
  function findColumns(doc,win){
    const found=[];
    const seeds=[...doc.querySelectorAll('[data-message-author-role="assistant"], [data-message-author-role="user"], [data-testid^="conversation-turn-"]')].slice(0,12);
    for(const seed of seeds){
      if(seed.closest('pre,table,textarea,input,[contenteditable="true"]'))continue;
      let node=seed.parentElement;
      for(let depth=0;node&&depth<10;depth++,node=node.parentElement){
        if(node===doc.body||node===doc.documentElement)break;
        if(node.matches('pre,table,textarea,input,button,aside,nav'))break;
        const style=win.getComputedStyle(node),geometry=columnGeometry(style);
        if(geometry){if(!found.some(x=>x.node===node))found.push({node,geometry});break;}
      }
    }
    return found;
  }
  function ancestorInsets(node,doc,win){
    let sum=0,scrollbars=0;
    for(let parent=node.parentElement,depth=0;parent&&depth<12;parent=parent.parentElement,depth++){
      const s=win.getComputedStyle(parent);
      // Do not count centered auto margins: their used pixels vary with viewport.
      sum+=number(s.paddingLeft)+number(s.paddingRight)+number(s.borderLeftWidth)+number(s.borderRightWidth);
      if(parent===doc.body)sum+=number(s.marginLeft)+number(s.marginRight);
      if(parent!==doc.body&&parent!==doc.documentElement&&Number.isFinite(parent.offsetWidth)&&Number.isFinite(parent.clientWidth)){
        scrollbars+=Math.min(32,Math.max(0,parent.offsetWidth-parent.clientWidth-number(s.borderLeftWidth)-number(s.borderRightWidth)));
      }
      if(parent===doc.documentElement)break;
    }
    return {insets:sum,scrollbars};
  }
  function inspect(doc,{compact=false,scrollbarAllowance=0,frameBorder=2}={}){
    const win=doc?.defaultView;
    if(!win?.getComputedStyle||!doc?.documentElement||!doc.querySelectorAll)return {detected:false,outerMax:1400,columns:[],scrollbarAllowance};
    // Temporarily untag our own rules, synchronously, so responsive native CSS is
    // measured rather than feeding our previous compact dimensions back in.
    const tagged=[...doc.querySelectorAll('['+COLUMN_ATTR+']')];
    const tags=tagged.map(node=>[node,node.getAttribute(COLUMN_ATTR)]);
    tagged.forEach(node=>node.removeAttribute(COLUMN_ATTR));
    let columns;
    try{
      columns=findColumns(doc,win).map(({node})=>{
        const geometry=columnGeometry(win.getComputedStyle(node),compact);
        const ancestor=ancestorInsets(node,doc,win);
        return {node,...geometry,ancestorInsets:ancestor.insets,ancestorScrollbars:ancestor.scrollbars};
      });
    }finally{tags.forEach(([node,value])=>node.setAttribute(COLUMN_ATTR,value));}
    const actualScrollbar=Math.max(0,(win.innerWidth||doc.documentElement.clientWidth)-doc.documentElement.clientWidth);
    // A nondecreasing allowance within this document prevents scrollbar/wrap
    // thresholds from causing a width oscillation. No timer/polling is needed.
    const nestedScrollbar=Math.max(0,...columns.map(c=>c.ancestorScrollbars));
    const allowance=Math.max(scrollbarAllowance,Math.min(64,actualScrollbar+nestedScrollbar));
    const max=columns.length?Math.max(...columns.map(c=>requiredOuterWidth(c.columnMax,c.ancestorInsets,allowance,frameBorder))):1400;
    return {detected:columns.length>0,outerMax:max,columns,scrollbarAllowance:allowance};
  }
  function apply(doc,measurement){
    const selected=new Set(measurement.columns.map(c=>c.node));
    doc.querySelectorAll('['+COLUMN_ATTR+']').forEach(node=>{if(!selected.has(node))node.removeAttribute(COLUMN_ATTR);});
    let style=doc.getElementById(STYLE_ID);
    const rules=measurement.columns.map((c,i)=>{
      const tag=String(i+1);if(c.node.getAttribute(COLUMN_ATTR)!==tag)c.node.setAttribute(COLUMN_ATTR,tag);
      return `[${COLUMN_ATTR}="${tag}"]{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:${c.columnMax}px!important;padding-left:${c.paddingLeft}px!important;padding-right:${c.paddingRight}px!important}`;
    }).join('\n');
    // Preserve native code/table wrapping and controls. Only the verified outer
    // conversation wrapper changes, not bubbles, pre, table or composer styles.
    if(!rules){if(style)style.remove();return;}
    if(!style){style=doc.createElement('style');style.id=STYLE_ID;doc.documentElement.appendChild(style);}
    if(style.textContent!==rules)style.textContent=rules;
  }
  const api={COLUMN_ATTR,STYLE_ID,GUTTER,pixels,columnGeometry,requiredOuterWidth,findColumns,inspect,apply};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CGWWLayout=api;
})(globalThis);
