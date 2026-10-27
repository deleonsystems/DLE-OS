const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require('path').join(__dirname,'../../SRC/workspaces/rfqs/slide-organizer.js'),'utf8');
class Node {
 constructor(tag='div',attrs={},rect={left:0,top:0,right:500,bottom:400}){this.tagName=tag.toUpperCase();this.dataset={...attrs};this.children=[];this.parent=null;this.listeners={};this.rect=rect;this.scrollTop=0;this.hidden=false;this.clicks=0;this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x)};this.style={};}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 contains(n){return n===this||this.children.some(c=>c.contains(n));}
 matches(s){if(s==='input,textarea,select')return ['INPUT','TEXTAREA','SELECT'].includes(this.tagName);if(s.startsWith('.'))return this.classes.has(s.slice(1));if(s==='header')return this.tagName==='HEADER';const m=/^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(s);if(!m)return false;const k=m[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return k in this.dataset&&(m[2]===undefined||this.dataset[k]===m[2]);}
 closest(s){return this.matches(s)?this:this.parent?.closest(s)||null;}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 addEventListener(name,fn,opts={}){(this.listeners[name]??=[]).push({fn,opts});}
 emit(name,event={}){const e={target:this,preventDefault(){this.prevented=true;},...event};for(const item of [...(this.listeners[name]||[])])if(!item.opts.signal?.aborted){item.fn(e);if(item.opts.once)this.listeners[name]=this.listeners[name].filter(i=>i!==item);}return e;}
 getBoundingClientRect(){return this.rect;}
 scrollIntoView(){this.scrolled=true;}
 setPointerCapture(){}
 click(){this.clicks++;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
 setAttribute(){}
}
let hit=null;
const document={createElement:tag=>new Node(tag),elementFromPoint:()=>hit};
const window={};vm.runInNewContext(source,{window,document,AbortController,CSS:{escape:s=>s},requestAnimationFrame:()=>1,cancelAnimationFrame(){},Date});
const api=window.DleSlideOrganizer;
let captured='';const factory=(title,html)=>{assert.equal(title,'Organize Slides');captured=html;const d=new Node('dialog'),header=new Node('header'),actions=new Node();actions.classes.add('labor-organizer-top-actions');d.append(header,actions,new Node('button',{cancel:''}));return d;};
api.create({flat:true,dialogFactory:factory,helpText:'Move draft pages.'});assert(!captured.includes('data-org-materials'));assert(!captured.includes('operation'));assert(captured.includes('data-org-insert'));
api.create({dialogFactory:factory});assert(captured.includes('data-org-materials'));assert(captured.includes('Collapse a group'));
const tile=api.tile({id:'a"',title:'<Title>',kindLabel:'note',snippet:'A & B'},0);assert(tile.includes('data-org-card="a&quot;"'));assert(tile.includes('1. &lt;Title&gt;'));assert(tile.includes('A &amp; B'));
let checks=3;
function fixture(flat=true){
 const d=new Node('dialog');if(flat)d.classes.add('labor-organizer-flat');const scroller=new Node();scroller.classes.add('labor-organizer-groups');const status=new Node('p',{orgSelection:''});d.append(scroller,status);
 const group=new Node('section',{ownerSection:'one'});const second=new Node('section',{ownerSection:'two'});if(!flat)scroller.append(group,second);
 const a=new Node('button',{orgCard:'a'},{left:10,top:10,right:110,bottom:110}),b=new Node('button',{orgCard:'b'},{left:140,top:10,right:240,bottom:110}),c=new Node('button',{orgCard:'c'},{left:270,top:10,right:370,bottom:110});
 if(flat)scroller.append(a,b,c);else{group.append(a,b);second.append(c);const empty=new Node('button',{orgSection:'two'});empty.classes.add('labor-organizer-collapsed-target');second.append(empty);}
 for(const command of ['copy','paste','delete','undo'])d.append(new Node('button',{['org'+command[0].toUpperCase()+command.slice(1)]:''}));
 let selected='a',locked=false;const moves=[],opened=[],errors=[];const collapsed=new Set();const rows=[{id:'a',title:'A',movable:true,owner:flat?undefined:'one'},{id:'b',title:'B',movable:true,owner:flat?undefined:'one'},{id:'c',title:'C',movable:false,owner:flat?undefined:'two'}];
 const controller=api.attachMovement(d,{getEntries:()=>rows,getSelected:()=>selected,setSelected:id=>selected=id,move:(id,target)=>moves.push({id,target}),open:id=>opened.push(id),controls(){},error:message=>errors.push(message),isBusy:()=>locked,isCollapsed:id=>collapsed.has(id),ownerLabel:id=>id||'draft slides',normalizeTarget:t=>t?.anchor==='c'?{...t,side:'before'}:t});
 const key=(node,key,extra={})=>d.emit('keydown',{target:node,key,...extra});
 return {d,scroller,group,second,status,a,b,c,rows,controller,moves,opened,errors,collapsed,key,lock:v=>locked=v};
}
{
 const f=fixture();f.key(f.a,' ');assert(f.controller.active);f.key(f.a,'ArrowRight');f.key(f.a,'Enter');assert.equal(f.moves[0].id,'a');assert.equal(f.moves[0].target.anchor,'b');assert.equal(f.moves[0].target.side,'before');assert.equal(f.moves[0].target.owner,undefined);checks++;
 f.key(f.b,' ');f.key(f.b,'ArrowLeft');f.key(f.b,'Escape');assert.equal(f.moves.length,1);assert(!f.controller.active);checks++;
 f.key(f.c,' ');assert(!f.controller.active);f.key(f.c,'Enter');assert.deepEqual(f.opened,['c']);checks++;
 f.key(f.a,'c',{ctrlKey:true});assert.equal(f.d.querySelector('[data-org-copy]').clicks,1);f.lock(true);f.key(f.a,'Enter');assert.deepEqual(f.opened,['c']);f.lock(false);checks++;
 for(const command of ['copy','paste','delete'])f.d.querySelector('[data-org-'+command+']').remove();for(const key of ['c','v'])assert.doesNotThrow(()=>f.key(f.a,key,{ctrlKey:true}));assert.doesNotThrow(()=>f.key(f.a,'Delete'));checks++;
 f.key(f.a,'Shift');hit=f.b;f.d.emit('pointerdown',{target:f.a,button:0,pointerId:1,pointerType:'mouse',clientX:40,clientY:40});f.d.emit('pointermove',{target:f.a,pointerId:1,clientX:225,clientY:40});assert(f.controller.dragging);f.d.emit('pointerup',{target:f.a,pointerId:1,pointerType:'mouse',clientX:225,clientY:40});assert.equal(f.moves.at(-1).target.side,'after');assert.equal(f.moves.at(-1).target.anchor,'b');assert(f.controller.suppressClick);checks++;
 hit=f.scroller;f.d.emit('pointerdown',{target:f.a,button:0,pointerId:2,clientX:40,clientY:40});f.d.emit('pointermove',{target:f.a,pointerId:2,clientX:125,clientY:40});f.d.emit('pointerup',{target:f.a,pointerId:2,pointerType:'mouse',clientX:125,clientY:40});assert.equal(f.moves.at(-1).target.anchor,'a');assert.equal(f.moves.at(-1).target.side,'after');checks++;
 f.controller.destroy();assert(!f.controller.active);const n=f.opened.length;f.key(f.a,'Enter');assert.equal(f.opened.length,n);assert.deepEqual(f.errors,[]);checks++;
}
{
 const f=fixture(false);f.key(f.a,' ');for(let n=0;n<3;n++)f.key(f.a,'ArrowRight');f.key(f.a,'Enter');assert.equal(f.moves[0].target.owner,'two');assert.equal(f.moves[0].target.anchor,'c');assert.equal(f.moves[0].target.side,'before');checks++;
 f.collapsed.add('two');hit=f.second.querySelector('.labor-organizer-collapsed-target');f.key(f.a,'Shift');f.d.emit('pointerdown',{target:f.a,button:0,pointerId:1,clientX:40,clientY:40});f.d.emit('pointermove',{target:f.a,pointerId:1,clientX:100,clientY:60});f.d.emit('pointerup',{target:f.a,pointerId:1,pointerType:'mouse',clientX:100,clientY:60});assert.equal(f.moves.at(-1).target.owner,'two');assert.equal(f.moves.at(-1).target.anchor,null);checks++;
 f.d.emit('close');assert(!f.controller.active);assert.deepEqual(f.errors,[]);checks++;
}
console.log(`PASS ${checks} shared organizer checks: flat/grouped shell, escaping, keyboard move/cancel/open, locked/busy gating, pointer and gutter targets, grouped boundaries/collapse, cleanup.`);
