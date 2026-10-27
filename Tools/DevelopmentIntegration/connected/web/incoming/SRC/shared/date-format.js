(function(window){
  'use strict';
  // Display only. Never use these strings for inputs, storage, identity or sorting.
  function calendar(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if(!match)return null;
    const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);
    const leap=y%4===0&&(y%100!==0||y%400===0);
    if(y<1||m<1||m>12||d<1||d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1])return null;
    return match[2]+'/'+match[3]+'/'+match[1];
  }
  function read(value){
    if(value===null||value===undefined||value==='')return null;
    if(typeof value==='string'){
      const text=value.trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(text)){const day=calendar(text);return day?{day}:null;}
      // Only unambiguous ISO timestamp strings; never reinterpret folder names or free text.
      if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text)||!calendar(text.slice(0,10)))return null;
      value=text;
    }else if(typeof value!=='number'&&!(value instanceof Date))return null;
    const instant=new Date(value);
    return Number.isFinite(instant.getTime())?{instant}:null;
  }
  function dateText(instant,timeZone){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',...(timeZone?{timeZone}:{})}).formatToParts(instant).map(p=>[p.type,p.value]));
    return parts.month+'/'+parts.day+'/'+parts.year.padStart(4,'0');
  }
  function date(value,options={}){
    const parsed=read(value);if(!parsed)return options.empty??'-';
    return parsed.day||dateText(parsed.instant,options.timeZone);
  }
  function dateTime(value,options={}){
    const parsed=read(value);if(!parsed)return options.empty??'-';
    if(parsed.day)return parsed.day;
    const time=new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hour12:options.hour12??true,...(options.seconds?{second:'2-digit'}:{}),...(options.timeZone?{timeZone:options.timeZone}:{}),...(options.timeZoneName?{timeZoneName:options.timeZoneName}:{})}).format(parsed.instant);
    return dateText(parsed.instant,options.timeZone)+', '+time;
  }
  window.DleDateFormat=Object.freeze({date,dateTime});
})(window);
