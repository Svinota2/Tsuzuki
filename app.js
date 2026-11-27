import { api, configured } from './cloud-api.js';
import { mountAuth } from './auth-form.js';
import { initPlayer, openPlayer, enterPlayer, pausePlayer } from './players.js';

const $ = id => document.getElementById(id);
let login=null, pending=null, version=0, toastTimer, localUrl;
const labels={planned:'Буду смотреть',watching:'Смотрю',completed:'Просмотрено',on_hold:'Отложено',dropped:'Брошено'};
function note(text) {
  $('message').textContent=text;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('message').textContent='',4500);
}
function setUser(value){
  login=value;
  $('profile').textContent=login ? '@'+login : 'Войти';
  $('logged').hidden=!login; $('auth').hidden=!!login;
  $('who').textContent=login||'';
  if(!login){$('account-count').textContent='—';$('account-watching').textContent='—';$('account-completed').textContent='—';}
}
async function accountStats(){
  if(!login)return;
  try{
    const rows=await api('library');
    $('account-count').textContent=rows.length;
    $('account-watching').textContent=rows.filter(a=>a.status==='watching').length;
    $('account-completed').textContent=rows.filter(a=>a.status==='completed').length;
  }catch(e){note(e.message);}
}
function el(tag,text,cls){
  const n=document.createElement(tag); if(text)n.textContent=text; if(cls)n.className=cls; return n;
}
function button(label,act,cls){
  const b=el('button',label,cls);
  b.onclick=async()=>{b.disabled=true;try{await act();}catch(e){note(e.message);}finally{b.disabled=false;}};
  return b;
}
async function catalog(){
  const rev=++version;
  $('catalog-state').textContent='Загружаем каталог…'; $('titles').replaceChildren();
  try{
    const rows=await api('catalog?q='+encodeURIComponent($('search').elements.q.value.trim()));
    if(rev!==version)return;
    $('catalog-state').textContent=rows.length?'':'По этому запросу ничего не найдено.';
    if(rows.length && !$('search').elements.q.value.trim()){
      const a=rows[0], feature=el('article',null,'feature');
      const art=el('img');art.src=a.poster;art.alt='';feature.append(art);
      const copy=el('div',null,'feature-copy');
      copy.append(el('small',[a.year,...a.genres.slice(0,2)].filter(Boolean).join('  ·  ')),el('h2',a.title));
      if(a.original!==a.title)copy.append(el('p',a.original));
      copy.append(button('Добавить в библиотеку',async()=>{
        if(!login){pending=a;location.hash='account';return;}
        await api('library','POST',a);note('Тайтл в библиотеке');
      },'add'));
      copy.append(button('Смотреть',()=>openPlayer(a.title)));
      feature.append(copy);$('titles').append(feature,el('h2','Популярные тайтлы','shelf-title'));
    }
    for(const a of rows){
      const card=el('article',null,'card');
      const poster=el(a.poster?'img':'div',null,'poster');
      if(a.poster){poster.src=a.poster;poster.alt='';poster.loading='lazy';}
      const meta=[a.year,a.episodes ? a.episodes+' сер.' : '',Number(a.score)>0?'★ '+a.score:''].filter(Boolean).join(' · ');
      card.append(poster,el('strong',a.title),el('small',meta),button('В библиотеку',async()=>{
        if(!login){pending=a;location.hash='account';note('Войдите, чтобы сохранить тайтл');return;}
        await api('library','POST',a);note('Тайтл в библиотеке');
      },'add'),button('Смотреть',()=>openPlayer(a.title)));
      $('titles').append(card);
    }
  }catch(e){if(rev===version)$('catalog-state').textContent=e.message;}
}
async function library(){
  const rev=++version, root=$('entries');root.replaceChildren();
  if(!login){root.append(button('Войти в аккаунт',()=>location.hash='account'));return;}
  const rows=await api('library');
  if(rev!==version)return;
  if(!rows.length)root.append(el('p','Пока пусто. Добавьте первый тайтл из каталога.'));
  for(const a of rows){
    const row=el('article',null,'row'),controls=el('div',null,'controls'),select=el('select');
    select.setAttribute('aria-label','Статус '+a.title);
    for(const [key,value] of Object.entries(labels))select.add(new Option(value,key,false,key===a.status));
    select.onchange=async()=>{
      select.disabled=true;
      try{await api('library','PATCH',{id:a.id,status:select.value});a.status=select.value;}
      catch(e){select.value=a.status;note(e.message);}finally{select.disabled=false;}
    };
    const counter=el('span','Серий: '+a.watched);
    const change=async delta=>{await api('library','PATCH',{id:a.id,delta});await library();};
    controls.append(button('−',()=>change(-1)),counter,button('+',()=>change(1)),button('Смотреть',()=>openPlayer(a.title)),select,button('Удалить',async()=>{
      if(confirm('Удалить «'+a.title+'» из библиотеки?')){await api('library','DELETE',{id:a.id});await library();}
    }));
    row.append(el('h2',a.title),controls);root.append(row);
  }
}
async function render(){
  const section=location.hash.slice(1);
  const current=['library','player','account'].includes(section)?section:'catalog';
  version++;
  document.querySelectorAll('main section').forEach(n=>n.hidden=n.id!==current);
  document.querySelectorAll('nav a').forEach(a=>a.setAttribute('aria-current',a.hash==='#'+current?'page':'false'));
  if(current==='player')enterPlayer();else pausePlayer();
  try{if(current==='catalog')await catalog();if(current==='library')await library();if(current==='account')await accountStats();}catch(e){note(e.message);}
}
$('logout').onclick=async()=>{try{await api('logout','POST',{});pending=null;setUser(null);$('entries').replaceChildren();note('Вы вышли из аккаунта');}catch(e){note(e.message);}};
$('search').onsubmit=e=>{e.preventDefault();catalog();};
function accountHint(text) {
  const hint=$('auth-hint');
  hint.textContent=text; hint.hidden=!text;
}
if(configured){
  mountAuth($('auth'),{
    initial:new URLSearchParams(location.search).get('mode')==='register'?'register':'login',
    notify: accountHint,
    async onLogin(email){
      setUser(email);
      accountHint('');
      if(pending){
        try{await api('library','POST',pending);pending=null;}
        catch(err){note(err.message);}
      }
      location.hash='library';
    }
  });
}else{
  accountHint('Облачные аккаунты ещё не подключены.');
}try{setUser((await api('me')).login);}catch(e){note('Не удалось проверить вход');}
window.addEventListener('hashchange',render);
window.addEventListener('pageshow',async e=>{if(e.persisted){try{setUser((await api('me')).login);render();}catch(err){note(err.message);}}});
render();
