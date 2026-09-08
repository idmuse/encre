// ── Éditeur ──────────────────────────────────────────────
import { getP, getCI, setCI, totalMotsProjet, mettreAJourStatsJour } from './state.js';
import { flash } from './utils.js';
import { sb, sbUser, setSaveStatus } from './auth.js';

function mnavSetActive(id){
  document.querySelectorAll('.mnav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
function mnavWrite(){
  document.getElementById('sidebar')?.classList.remove('mob-open');
  document.getElementById('panel')?.classList.remove('mob-open');
  mnavSetActive('mnav-write');
  document.getElementById('editor')?.focus();
}
function mnavChapitres(){
  const sb=document.getElementById('sidebar');
  const isOpen=sb?.classList.contains('mob-open');
  document.getElementById('panel')?.classList.remove('mob-open');
  if(isOpen){ sb.classList.remove('mob-open'); mnavSetActive('mnav-write'); }
  else{ sb?.classList.add('mob-open'); mnavSetActive('mnav-chaps'); }
}
function mnavPanel(){
  const panel=document.getElementById('panel');
  const isOpen=panel?.classList.contains('mob-open');
  document.getElementById('sidebar')?.classList.remove('mob-open');
  if(isOpen){ panel.classList.remove('mob-open'); mnavSetActive('mnav-write'); }
  else{ panel?.classList.add('mob-open'); mnavSetActive('mnav-panel'); }
}

// ── SERVICE WORKER DÉSACTIVÉ ─────────────────────────────
// (retiré pour éviter les problèmes de cache lors des mises à jour)

// ── Fiche projet (modal) ──────────────────────────────────
export function ouvrirFicheProjet(){
  document.getElementById('m-titre').value=P.titre||'';
  document.getElementById('m-sous').value=P.sousTitre||'';
  document.getElementById('m-auteur').value=P.auteur||'';
  document.getElementById('m-genre').value=P.genre||'';
  document.getElementById('m-annee').value=P.annee||'';
  document.getElementById('m-syn').value=P.synopsis||'';
  document.getElementById('modal-bg').classList.add('on');
  setTimeout(()=>document.getElementById('m-titre').focus(),50);
}
function fermerModal(){ document.getElementById('modal-bg').classList.remove('on'); }

function updateSbProjet(){
  document.getElementById('sbp-titre').textContent=P.titre||'Sans titre';
  document.getElementById('sbp-auteur').textContent=P.auteur||'';
  const meta=[P.genre,P.annee].filter(Boolean).join(' · ');
  document.getElementById('sbp-meta').textContent=meta;
  document.getElementById('s-titre').textContent=P.titre||'';
}

// ── Formatage texte ───────────────────────────────────────
export function alignerTexte(align){
  document.execCommand('justify' + align.charAt(0).toUpperCase() + align.slice(1), false, null);
  document.getElementById('editor').focus();
}

function fmtCmd(cmd){ document.execCommand(cmd,false,null); document.getElementById('editor').focus(); }

// ── TEXTOS ────────────────────────────────────────────────
export function insererTexto(cote){
  const nom=prompt('Prénom du personnage :','');
  if(nom===null) return;
  const nomFinal=nom.trim()||'Personnage';
  const ed=document.getElementById('editor');
  ed.focus();
  const bloc=document.createElement('div');
  bloc.className=`texto-bloc ${cote}`;
  bloc.setAttribute('data-texto',cote);
  bloc.setAttribute('data-nom',nomFinal);
  bloc.innerHTML=`<div class="texto-bulle">
    <div class="texto-nom" contenteditable="true" spellcheck="false">${nomFinal}</div>
    <div class="texto-msg" contenteditable="true" spellcheck="true">Message…</div>
    <div class="texto-controls">
      <button class="texto-ctrl-btn" id="btn-cote-${Date.now()}">⇄ Côté</button>
      <button class="texto-ctrl-btn" id="btn-del-${Date.now()}" style="color:var(--accent)">✕</button>
    </div>
  </div>
  <div class="texto-tag">${cote==='droite'?'##droite':'##gauche'}:${nomFinal}</div>`;
  bloc.querySelector('[id^=btn-cote]').addEventListener('mousedown', e=>{ e.preventDefault(); basculerCote(e.target); });
  bloc.querySelector('[id^=btn-del]').addEventListener('mousedown', e=>{ e.preventDefault(); bloc.remove(); edChange(); });
  bloc.querySelector('.texto-nom').addEventListener('input',e=>{
    const n=e.target.textContent.trim();
    bloc.setAttribute('data-nom',n);
    const c=bloc.getAttribute('data-texto');
    bloc.querySelector('.texto-tag').textContent=`${c==='droite'?'##droite':'##gauche'}:${n}`;
  });
  const sel=window.getSelection();
  if(sel.rangeCount){ const r=sel.getRangeAt(0); r.collapse(false); r.insertNode(bloc); }
  else ed.appendChild(bloc);
  const msg=bloc.querySelector('.texto-msg');
  msg.focus();
  const r=document.createRange(); r.selectNodeContents(msg); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  edChange();
}
export function basculerCote(btn){
  const bloc=btn.closest('.texto-bloc');
  const c=bloc.getAttribute('data-texto');
  const n=c==='droite'?'gauche':'droite';
  bloc.className=`texto-bloc ${n}`; bloc.setAttribute('data-texto',n);
  bloc.querySelector('.texto-tag').textContent=`${n==='droite'?'##droite':'##gauche'}:${bloc.getAttribute('data-nom')}`;
  edChange();
}
function repairerTextos(){
  document.querySelectorAll('#editor .texto-bloc').forEach(bloc=>{
    const bulle = bloc.querySelector('.texto-bulle');
    if(!bulle) return;
    // Toujours supprimer les vieux controls (peuvent avoir onmousedown inline obsolète)
    bulle.querySelectorAll('.texto-controls').forEach(c=>c.remove());
    // Recréer avec addEventListener
    const ctrl = document.createElement('div');
    ctrl.className = 'texto-controls';
    const btnCote = document.createElement('button');
    btnCote.className = 'texto-ctrl-btn';
    btnCote.textContent = '⇄ Côté';
    btnCote.addEventListener('mousedown', e=>{ e.preventDefault(); basculerCote(btnCote); });
    const btnDel = document.createElement('button');
    btnDel.className = 'texto-ctrl-btn';
    btnDel.textContent = '✕';
    btnDel.style.color = 'var(--accent)';
    btnDel.addEventListener('mousedown', e=>{ e.preventDefault(); bloc.remove(); edChange(); });
    ctrl.appendChild(btnCote);
    ctrl.appendChild(btnDel);
    bulle.appendChild(ctrl);
  });
}

// ── Tiret cadratin + typo française ──────────────────────
export function edKey(e){
  const sel=window.getSelection();
  if(!sel.rangeCount) return;
  const r=sel.getRangeAt(0);
  const n=r.startContainer;
  if(n.nodeType!==3) return;
  const t=n.textContent, p=r.startOffset;

  // Autocorrection
  appliquerAutocorrection(e);
  majusculeApresPoint(e);

  // Entrée → créer un nouveau <p> propre
  if(e.key==='Enter' && !e.shiftKey){
    e.preventDefault();
    document.execCommand('insertParagraph');
    edChange(); return;
  }

  // -- + espace/entrée → tiret cadratin
  if((e.key===' '||e.key==='Enter') && p>=2 && t.slice(p-2,p)==='--'){
    e.preventDefault();
    const ins=e.key==='Enter'?'—':'—\u00A0';
    n.textContent=t.slice(0,p-2)+ins+t.slice(p);
    setCaret(n,p-2+ins.length);
    if(e.key==='Enter') document.execCommand('insertParagraph');
    const h=document.getElementById('ch');
    h.classList.add('on'); clearTimeout(h._t); h._t=setTimeout(()=>h.classList.remove('on'),1100);
    edChange(); return;
  }

  // Correction automatique : d'ou → d'où
  if([' ','\u00a0',',','.',';',':','?','!'].includes(e.key)){
    const avant=t.slice(0,p);
    const corrections=[["d'ou","d'où"],["D'ou","D'où"],["d\u2019ou","d\u2019où"],["D\u2019ou","D\u2019où"],["jusqu'ou","jusqu'où"],["Jusqu'ou","Jusqu'où"]];
    for(const [de,vers] of corrections){
      if(avant.length>=de.length && avant.endsWith(de)){
        e.preventDefault();
        const ins = [' ','\u00a0'].includes(e.key) ? ' ' : e.key;
        n.textContent=t.slice(0,p-de.length)+vers+ins+t.slice(p);
        setCaret(n,p-de.length+vers.length+ins.length);
        edChange(); return;
      }
    }
  }

  // Guillemets automatiques " → « » avec espaces fines insécables
  if(e.key==='"'){
    e.preventDefault();
    const avant = t.slice(0, p);
    const ouvert = (avant.match(/«/g)||[]).length > (avant.match(/»/g)||[]).length;
    if(ouvert){
      const ins = '\u202f»'; // espace fine insécable avant »
      n.textContent = t.slice(0,p) + ins + t.slice(p);
      setCaret(n, p + ins.length);
    } else {
      const ins = '«\u202f'; // espace fine insécable après «
      n.textContent = t.slice(0,p) + ins + t.slice(p);
      setCaret(n, p + ins.length);
    }
    edChange(); return;
  }

  // coeur → cœur, soeur → sœur, oeuf → œuf (après espace)
  if([' ','\u00a0',',','.'].includes(e.key)){
    const avant=t.slice(0,p);
    const ligs=[['coeur','cœur'],['Coeur','Cœur'],['soeur','sœur'],['Soeur','Sœur'],['oeuf','œuf'],['Oeuf','Œuf'],['oeil','œil'],['Oeil','Œil'],['oeuvre','œuvre'],['Oeuvre','Œuvre']];
    for(const [de,vers] of ligs){
      if(avant.endsWith(de)){
        e.preventDefault();
        const ins = e.key===' '||e.key==='\u00a0' ? '\u00a0' : e.key;
        n.textContent=t.slice(0,p-de.length)+vers+ins+t.slice(p);
        setCaret(n,p-de.length+vers.length+1);
        edChange(); return;
      }
    }
  }

  // Frappe de :;?!» → insérer espace fine insécable AVANT si le char précédent n'en est pas déjà une
  if(':;?!»'.includes(e.key)){
    const prev=t[p-1];
    if(prev && prev!=='\u202F' && prev!=='\u00A0' && prev!==' '){
      e.preventDefault();
      n.textContent=t.slice(0,p)+'\u202F'+e.key+t.slice(p);
      setCaret(n,p+2); edChange(); return;
    }
  }

  // Frappe de « → insérer le guillemet puis espace fine insécable après
  if(e.key==='«'){
    e.preventDefault();
    n.textContent=t.slice(0,p)+'«\u202F'+t.slice(p);
    setCaret(n,p+2); edChange(); return;
  }
}

function setCaret(node,pos){
  const nr=document.createRange();
  nr.setStart(node,Math.min(pos,node.textContent.length));
  nr.collapse(true);
  const sel=window.getSelection();
  sel.removeAllRanges(); sel.addRange(nr);
}

// ── Chapitres ─────────────────────────────────────────────
export function renderSidebar(){
  const L=document.getElementById('chap-list'); L.innerHTML='';
  let currentSection = null;
  let sectionCollapsed = false;

  P.chapitres.forEach((c,i)=>{
    const niv=c.niveau||2;
    const d=document.createElement('div');

    if(niv===1){
      const isCollapsed = c._collapsed || false;
      d.className='ci niveau1'+(isCollapsed?' collapsed':'')+(i===chapI?' on':'');
      d.innerHTML=`<span class="ci-arrow">▾</span><span class="ci-t">${c.titre||'Sans titre'}</span>`;
      // Flèche = replier/déplier
      d.querySelector('.ci-arrow').onclick=(e)=>{
        e.stopPropagation();
        c._collapsed = !c._collapsed;
        renderSidebar();
      };
      // Titre = ouvrir dans l'éditeur
      d.onclick=()=>{ save(); loadChap(i); };
      currentSection = i;
      sectionCollapsed = isCollapsed;
    } else {
      d.className='ci niveau2'+(i===chapI?' on':'')+(sectionCollapsed?' hidden':'');
      d.innerHTML=`<span class="ci-t">${c.titre||'Sans titre'}</span><span class="ci-w">${c.mots||0}m</span>`;
      d.onclick=()=>{ save(); loadChap(i); };
    }

    d.oncontextmenu=(e)=>{
      e.preventDefault();
      const niv2=c.niveau||2;
      const label1 = niv2===1 ? '→ Convertir en chapitre (Titre 2)' : '→ Convertir en section (Titre 1)';
      const label2 = P.chapitres.length>1 ? `Supprimer "${c.titre}"` : null;
      if(confirm(label1+(label2?'\n\nAnnuler = '+label2:''))){
        P.chapitres[i].niveau = niv2===1?2:1;
        renderSidebar();
      } else if(label2 && P.chapitres.length>1){
        if(confirm(`Supprimer "${c.titre}" ?`)){
          const chapId = c.id;
          P.chapitres.splice(i,1);
          if(chapI>=P.chapitres.length) chapI=P.chapitres.length-1;
          loadChap(chapI);
          // Supprimer dans Supabase immédiatement (table chapitres + projets.contenu)
          if(P.projet_cloud_id){
            sb.from('chapitres').delete()
              .eq('projet_id', P.projet_cloud_id)
              .eq('chapitre_id', chapId)
              .then(({error}) => { if(error) console.warn('del chapitres:', error.message); });
            // Mettre à jour projets.contenu sans ce chapitre
            if(!P._collab){
              sb.from('projets').select('contenu').eq('id', P.projet_cloud_id).single()
                .then(({data}) => {
                  if(!data) return;
                  const contenu = data.contenu;
                  contenu.chapitres = (contenu.chapitres||[]).filter(ch => ch.id !== chapId);
                  sb.from('projets').update({ contenu }).eq('id', P.projet_cloud_id)
                    .then(() => {
                      // Mettre à jour le sessionStorage pour rester en sync
                      P.chapitres = P.chapitres.filter(ch => ch.id !== chapId);
                      sessionStorage.setItem('encre_projet_actif', JSON.stringify({ projet: P, chapI }));
                    });
                });
            }
          }
        }
      }
    };
    L.appendChild(d);
  });
}

export function loadChap(i){
  if(planMode){ planMode=false; document.getElementById('plan-view').classList.remove('on'); }
  fermerCarnetPage();
  if(carnetMode){ carnetMode=false; }
  document.getElementById('dashboard').classList.remove('on');
  document.getElementById('es').style.display='block';
  document.getElementById('fmt-bar').style.display='flex';
  setNavActive(null);
  chapI=i; const c=P.chapitres[i];
  // Poser le baseline = mots existants au moment du chargement
  _motsRef[c.id] = c.mots || 0;
  document.getElementById('editor').innerHTML=c.contenu||'';
  // Réparer le contenu fusionné par la migration ratée
  repairerContenu();
  // Reconstruire les contrôles des textos
  repairerTextos();
  document.getElementById('chap-ti').value=c.titre;
  document.getElementById('chap-n').textContent = (i+1)+'.';
  document.getElementById('s-chap').textContent=c.titre;
  // Scroll en haut sur mobile
  document.getElementById('ez')?.scrollTo(0,0);
  updateWC(); renderSidebar(); ltLastText=''; ltSchedule();
}

function repairerContenu(){
  const ed = document.getElementById('editor');
  const children = Array.from(ed.childNodes);
  // Détecter si tout est dans un seul noeud texte
  if(children.length === 1 && children[0].nodeType === 3){
    const txt = children[0].textContent;
    const paras = txt.split('\n').filter(s => s.trim());
    if(paras.length > 1){
      ed.innerHTML = paras.map(p => `<div>${p}</div>`).join('');
      // Mettre à jour P.chapitres aussi pour que l'export soit correct
      P.chapitres[chapI].contenu = ed.innerHTML;
    }
  }
  // Détecter un seul grand div avec tout dedans (migration ratée)
  if(children.length === 1 && children[0].nodeName === 'DIV'){
    const inner = children[0].innerHTML;
    // Si le div contient des &nbsp;&nbsp; ou beaucoup de texte sans sous-divs
    const subDivs = children[0].querySelectorAll('div, p').length;
    if(subDivs === 0 && inner.length > 200){
      const txt = children[0].innerText;
      const paras = txt.split('\n').filter(s => s.trim());
      if(paras.length > 1){
        ed.innerHTML = paras.map(p => `<div>${p}</div>`).join('');
        P.chapitres[chapI].contenu = ed.innerHTML;
      }
    }
  }
}

let _motsRef = {}; // non utilisé mais gardé pour compatibilité

export function save(){
  ltClearMarks();
  const c = P.chapitres[chapI];
  c.contenu = document.getElementById('editor').innerHTML;
  const t = document.getElementById('editor').innerText;
  c.mots = t.trim() ? t.trim().split(/\s+/).length : 0;
  updateWC();
}

function totalMotsProjet(){
  return P.chapitres.reduce((s,c) => s + (c.mots||0), 0);
}

let _totalMotsDebutSession = null;

function mettreAJourStatsJour(){
  const today = aujourdhui();
  if(!P.stats) P.stats = {};
  const totalActuel = totalMotsProjet();

  // Baseline = total sauvegardé dans Supabase lors de la dernière sauvegarde
  // P._totalMotsSauve est persisté dans Supabase avec le projet
  const baseline = P._totalMotsSauve ?? totalActuel;
  const diff = Math.max(0, totalActuel - baseline);
  if(diff > 0) P.stats[today] = (P.stats[today] || 0) + diff;
  // Mettre à jour le baseline pour la prochaine sauvegarde
  P._totalMotsSauve = totalActuel;
}

export function ajouterChap(){
  save();
  P.chapitres.push({id:P.nid++,titre:'Chapitre '+(P.chapitres.length+1),contenu:'',mots:0,niveau:2});
  loadChap(P.chapitres.length-1);
}

export function titreChap(v){ P.chapitres[chapI].titre=v; renderSidebar(); document.getElementById('s-chap').textContent=v; }

export function edChange(){ save(); updateWC(); setSaveStatus('pending'); }


// ── AUTOCORRECTION ────────────────────────────────────────
const CORRECTIONS_FIXES = {
  'poru':'pour','poru ':'pour ','avce':'avec','teh':'the',
  'pius':'puis','jsuis':'je suis','cest':'c\'est',
  'jcois':'je crois','jai':'j\'ai','tas':'t\'as',
  'ect':'etc','qque':'que','qqe':'quelque',
  'tt':'tout','tjrs':'toujours','bcp':'beaucoup',
  'pcq':'parce que','pck':'parce que','dsl':'désolé',
  'nv':'nouveau','nvx':'nouveaux','ms':'mais',
  'ss':'sans','dc':'donc','pk':'pourquoi',
  'vs':'vous','ns':'nous','vl':'vouloir',
  'avc':'avec','pr':'pour','qd':'quand',
};

// Charger corrections perso depuis localStorage
function getCorrectionsPerso(){
  try{ return JSON.parse(localStorage.getItem('encre_corrections')||'{}'); }
  catch(e){ return {}; }
}
function sauverCorrectionsPerso(obj){
  localStorage.setItem('encre_corrections', JSON.stringify(obj));
}

function appliquerAutocorrection(e){
  // Seulement sur espace, ponctuation
  if(![' ',',','.','!','?',';',':','\''].includes(e.key)) return;
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if(node.nodeType !== 3) return;
  const txt = node.textContent;
  const pos = range.startOffset;
  // Extraire le dernier mot
  const avant = txt.substring(0, pos);
  const m = avant.match(/(\S+)$/);
  if(!m) return;
  const mot = m[1].toLowerCase();
  const corrections = {...CORRECTIONS_FIXES, ...getCorrectionsPerso()};
  if(corrections[mot]){
    const remplacement = corrections[mot];
    const start = pos - m[1].length;
    node.textContent = txt.substring(0, start) + remplacement + txt.substring(pos);
    const newRange = document.createRange();
    newRange.setStart(node, start + remplacement.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

function majusculeApresPoint(e){
  if(e.key !== ' ') return;
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if(node.nodeType !== 3) return;
  const txt = node.textContent;
  const pos = range.startOffset;
  const avant = txt.substring(0, pos).trimEnd();
  // Ne pas majusculer après ... ou … (points de suspension)
  if(/\.{2,}$/.test(avant) || avant.endsWith('…')) return;
  // Ne pas majusculer si le point fait partie de "... mot" ou "…mot"
  const m = avant.match(/([.!?])\s+(\p{Ll}+)$/u);
  if(!m) return;
  // Vérifier que le point n'est pas précédé d'autres points
  const idxPoint = avant.lastIndexOf(m[1]);
  if(idxPoint > 0 && avant[idxPoint-1] === '.') return;
  const motStart = avant.lastIndexOf(m[2]);
  node.textContent = txt.substring(0, motStart) +
    m[2].charAt(0).toUpperCase() + m[2].slice(1) +
    txt.substring(motStart + m[2].length);
  const newRange = document.createRange();
  newRange.setStart(node, pos);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

export function ouvrirModalCorrections(){
  const perso = getCorrectionsPerso();
  const items = Object.entries(perso).map(([k,v])=>
    `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <code style="background:var(--paper3);padding:2px 6px;border-radius:3px;font-size:13px;">${k}</code>
      <span style="color:var(--ink4)">→</span>
      <code style="background:var(--paper3);padding:2px 6px;border-radius:3px;font-size:13px;">${v}</code>
      <button onclick="supprimerCorrection('${k}')" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:12px;margin-left:auto">✕</button>
    </div>`
  ).join('');

  document.getElementById('modal-bg').classList.add('on');
  document.getElementById('modal').innerHTML = `
    <h3>Mes corrections</h3>
    <p style="font-family:'Crimson Pro',serif;font-size:14px;color:var(--ink4);margin-bottom:16px">Les mots sont corrigés automatiquement quand tu appuies sur espace.</p>
    <div id="corrections-liste" style="margin-bottom:16px;max-height:200px;overflow-y:auto">${items||'<div style="color:var(--ink4);font-size:13px;font-style:italic">Aucune correction personnalisée.</div>'}</div>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:12px;width:100%;">
      <input id="corr-de" placeholder="Faute (ex: teh)" style="font-family:'Crimson Pro',serif;font-size:15px;padding:6px 8px;border:1px solid var(--paper3);border-radius:4px;background:var(--paper2);min-width:0;">
      <span style="color:var(--ink4);text-align:center">→</span>
      <input id="corr-vers" placeholder="Correction (ex: the)" style="font-family:'Crimson Pro',serif;font-size:15px;padding:6px 8px;border:1px solid var(--paper3);border-radius:4px;background:var(--paper2);min-width:0;">
    </div>
    <div class="fbr">
      <button class="fb fb-s" onclick="ajouterCorrection()">Ajouter</button>
      <button class="fb fb-c" onclick="fermerModal()">Fermer</button>
    </div>`;
}

function ajouterCorrection(){
  const de = document.getElementById('corr-de').value.trim().toLowerCase();
  const vers = document.getElementById('corr-vers').value.trim();
  if(!de||!vers) return;
  const perso = getCorrectionsPerso();
  perso[de] = vers;
  sauverCorrectionsPerso(perso);
  ouvrirModalCorrections();
}

function supprimerCorrection(mot){
  const perso = getCorrectionsPerso();
  delete perso[mot];
  sauverCorrectionsPerso(perso);
  ouvrirModalCorrections();
}
let ltIgnored = new Set();
let ltMatches = [];

function ltSchedule(){ /* LT manuel uniquement */ }

export async function ltTogglePanel(){
  const body = document.getElementById('acc-lt');
  const arrow = document.getElementById('arr-lt');
  const isOpen = body.style.display !== 'none';
  if(isOpen){
    body.style.display = 'none';
    arrow.textContent = '▸';
    ltClearHighlight();
  } else {
    body.style.display = 'flex';
    arrow.textContent = '▾';
    await ltOuvrirPanel();
  }
}

export async function ltOuvrirPanel(){
  const list = document.getElementById('lt-panel-list');
  list.innerHTML = '<div style="padding:10px 14px;font-family:\'Crimson Pro\',serif;font-size:13px;color:var(--ink4);font-style:italic">Analyse…</div>';
  setLtStatus('checking');

  const ed = document.getElementById('editor');
  const text = ed.innerText.trim();
  if(text.length < 3){ list.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--ink4);font-family:\'Crimson Pro\',serif;font-style:italic">Rien à analyser.</div>'; return; }

  try {
    const res = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        language: 'fr', text,
        disabledCategories: 'STYLE,PUNCTUATION,CASING,REDUNDANCY,COLLOQUIALISMS',
        disabledRules: 'WHITESPACE_RULE,CONSECUTIVE_SPACES,FRENCH_WHITESPACE,TOO_LONG_SENTENCE,UPPERCASE_SENTENCE_START,WORD_REPEAT_RULE,FR_AGREEMENT_POSTPONED_VERB,ACCORD_SUJET_VERBE'
      })
    });
    const data = await res.json();
    ltMatches = (data.matches||[]).filter(m=>!ltIgnored.has(m.message));
    ltRenderPanel();
    setLtStatus('ok');
  } catch(e){
    list.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--accent);font-family:\'Crimson Pro\',serif">Indisponible.</div>';
    setLtStatus('offline');
  }
}

function ltRenderPanel(){
  const list = document.getElementById('lt-panel-list');
  const n = ltMatches.length;
  // lt-status retiré de l'interface
  if(!n){
    list.innerHTML = '<div style="padding:12px 14px;font-family:\'Crimson Pro\',serif;font-size:14px;color:#4a8050;font-style:italic">✓ Aucune erreur !</div>';
    return;
  }
  list.innerHTML = '';
  ltMatches.forEach((m, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--paper3);cursor:pointer;transition:background .1s;';
    item.onmouseenter = ()=>{ item.style.background='var(--paper3)'; };
    item.onmouseleave = ()=>{ item.style.background=''; };
    const ctx = m.context?.text||'';
    const co = m.context?.offset||0;
    const cl = m.context?.length||0;
    const mot = ctx.slice(co, co+cl);
    item.innerHTML = `
      <div onclick="ltSurligner(${idx})" style="font-family:'Crimson Pro',serif;font-size:14px;color:var(--ink);margin-bottom:3px;">
        <span style="color:var(--accent);font-style:italic">${mot}</span>
        <span style="color:var(--ink4);font-size:12px;"> — ${m.message.length>60?m.message.substring(0,60)+'…':m.message}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4)">→</span>
        ${(m.replacements||[]).slice(0,3).map(r=>`<span onclick="ltAppliquer(${idx},'${r.value.replace(/'/g,"\\'")}')" style="font-family:'Crimson Pro',serif;font-size:13px;background:var(--paper2);border:1px solid var(--paper3);border-radius:3px;padding:1px 7px;cursor:pointer;color:var(--ink)">${r.value}</span>`).join('')}
        <span onclick="ltIgnorer(${idx})" style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4);cursor:pointer;margin-left:4px;text-decoration:underline">ignorer</span>
      </div>`;
    list.appendChild(item);
  });
}

// Surligner le mot dans l'éditeur
let ltHighlightEl = null;
function ltSurligner(idx){
  ltClearHighlight();
  const m = ltMatches[idx];
  if(!m) return;

  const ed = document.getElementById('editor');
  let pos = 0, found = false;

  function walk(node){
    if(found) return;
    if(node.nodeType === 3){
      const len = node.textContent.length;
      if(pos <= m.offset && m.offset + m.length <= pos + len){
        const localStart = m.offset - pos;
        const localEnd = localStart + m.length;
        const txt = node.textContent;
        const span = document.createElement('span');
        span.className = 'lt-highlight';
        span.textContent = txt.slice(localStart, localEnd);
        const after = document.createTextNode(txt.slice(localEnd));
        node.textContent = txt.slice(0, localStart);
        node.parentNode.insertBefore(span, node.nextSibling);
        node.parentNode.insertBefore(after, span.nextSibling);
        span.scrollIntoView({ behavior:'smooth', block:'center' });
        ltHighlightEl = span;
        found = true;
        return;
      }
      pos += len;
    } else if(node.nodeType === 1){
      if(['P','DIV'].includes(node.nodeName) && pos > 0) pos += 2;
      node.childNodes.forEach(walk);
    }
  }
  walk(ed);
}

function ltClearHighlight(){
  if(ltHighlightEl){
    const txt = document.createTextNode(ltHighlightEl.textContent);
    ltHighlightEl.parentNode.replaceChild(txt, ltHighlightEl);
    document.getElementById('editor').normalize();
    ltHighlightEl = null;
  }
}

function ltAppliquer(idx, remplacement){
  ltClearHighlight();
  const m = ltMatches[idx];
  if(!m) return;
  const ed = document.getElementById('editor');
  let pos = 0, found = false;
  function walk(node){
    if(found) return;
    if(node.nodeType === 3){
      const len = node.textContent.length;
      if(pos <= m.offset && m.offset + m.length <= pos + len){
        const localStart = m.offset - pos;
        const localEnd = localStart + m.length;
        const txt = node.textContent;
        node.textContent = txt.slice(0, localStart) + remplacement + txt.slice(localEnd);
        found = true; return;
      }
      pos += len;
    } else if(node.nodeType === 1){
      if(['P','DIV'].includes(node.nodeName) && pos > 0) pos += 2;
      node.childNodes.forEach(walk);
    }
  }
  walk(ed);
  const diff = remplacement.length - m.length;
  ltMatches.splice(idx, 1);
  ltMatches.forEach(mm => { if(mm.offset > m.offset) mm.offset += diff; });
  ltRenderPanel();
  edChange();
}

function ltIgnorer(idx){
  if(ltMatches[idx]) ltIgnored.add(ltMatches[idx].message);
  ltMatches.splice(idx, 1);
  ltRenderPanel();
}

function ltFermerPanel(){ /* plus nécessaire */ }

function ltClearMarks(){
  const ed = document.getElementById('editor');
  if(!ed) return;
  ed.querySelectorAll('.lt-err,.lt-highlight').forEach(span=>{
    span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
  });
  ed.normalize();
}

export function updateWC(){
  const t=document.getElementById('editor').innerText;
  const m=t.trim()?t.trim().split(/\s+/).length:0;
  document.getElementById('wc').textContent=m+' mots';
  const tot=P.chapitres.reduce((s,c)=>s+(c.mots||0),0);
  document.getElementById('s-total').textContent=tot+' mots';
  document.getElementById('sb-total-mots').textContent=tot.toLocaleString('fr-FR')+' mots';
}

// ── Vue Plan ─────────────────────────────────────────────
let planMode=false, planTabA='fiches', carnetMode=false, carnetActif=null;

export function togglePlan(){
  if(carnetMode){ carnetMode=false; }
  fermerCarnetPage();
  planMode=!planMode;
  save();
  document.getElementById('es').style.display=planMode?'none':'block';
  document.getElementById('fmt-bar').style.display=planMode?'none':'flex';
  document.getElementById('plan-view').classList.toggle('on',planMode);
  setNavActive(planMode?'nav-plan':null);
  if(planMode){ planTab(planTabA, document.querySelector('.plan-tab.on')||document.querySelector('.plan-tab')); }
}

export function planTab(which, btn){
  planTabA=which;
  document.querySelectorAll('.plan-tab').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  document.getElementById('plan-grid').style.display=which==='fiches'?'grid':'none';
  document.getElementById('plan-notes').style.display=which==='notes'?'block':'none';
  document.getElementById('plan-struct').style.display=which==='struct'?'block':'none';
  if(which==='fiches') renderPlan();
  else if(which==='notes') renderPlanNotes();
  else renderPlanStruct();
}

export function renderPlan(){
  const grid=document.getElementById('plan-grid');
  grid.innerHTML='';
  P.chapitres.forEach((ch,i)=>{
    const f=document.createElement('div');
    f.className='fiche'; f.draggable=true; f.dataset.i=i;
    const st=ch.statut||'brouillon';
    f.innerHTML=`<div class="fiche-num">Chapitre ${i+1}</div>
      <div class="fiche-titre" contenteditable="true" spellcheck="false">${ch.titre||''}</div>
      <div class="fiche-resume" contenteditable="true" spellcheck="false">${ch.resume||''}</div>
      <div class="fiche-footer">
        <span class="fiche-mots">${ch.mots||0} mots</span>
        <select class="fiche-statut st-${st}" onchange="setStatut(${i},this)">
          <option value="brouillon" ${st==='brouillon'?'selected':''}>Brouillon</option>
          <option value="reviser" ${st==='reviser'?'selected':''}>À revoir</option>
          <option value="final" ${st==='final'?'selected':''}>Final</option>
        </select>
      </div>`;
    f.querySelector('.fiche-titre').addEventListener('blur',e=>{ P.chapitres[i].titre=e.target.innerText.trim(); renderSidebar(); });
    f.querySelector('.fiche-resume').addEventListener('blur',e=>{ P.chapitres[i].resume=e.target.innerHTML; });
    f.addEventListener('dblclick',()=>{ togglePlan(); save(); loadChap(i); });
    f.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',i); f.classList.add('dragging'); });
    f.addEventListener('dragend',()=>{ f.classList.remove('dragging'); document.querySelectorAll('.fiche').forEach(x=>x.classList.remove('drag-over')); });
    f.addEventListener('dragover',e=>{ e.preventDefault(); f.classList.add('drag-over'); });
    f.addEventListener('dragleave',()=>f.classList.remove('drag-over'));
    f.addEventListener('drop',e=>{ e.preventDefault(); f.classList.remove('drag-over'); const from=parseInt(e.dataTransfer.getData('text/plain')); const to=parseInt(f.dataset.i); if(from===to)return; const ch=P.chapitres.splice(from,1)[0]; P.chapitres.splice(to,0,ch); renderPlan(); renderSidebar(); });
    grid.appendChild(f);
  });
  const add=document.createElement('div'); add.className='plan-add'; add.textContent='+'; add.title='Nouveau chapitre';
  add.onclick=()=>{ ajouterChap(); renderPlan(); };
  grid.appendChild(add);
}

function setStatut(i,sel){ P.chapitres[i].statut=sel.value; sel.className='fiche-statut st-'+sel.value; }

function renderPlanNotes(){
  const ed=document.getElementById('plan-notes-ed');
  ed.innerHTML=P.planNotes||'';
}

function renderPlanStruct(){
  const c=document.getElementById('plan-struct');
  if(!P.struct) P.struct={};
  const ACTES=[
    {id:'a1',label:'Acte I — Mise en place',sub:'Présentation du monde, du protagoniste et du déclencheur',
     blocs:[{id:'monde',label:'Le monde ordinaire',ph:'Comment est la vie du protagoniste avant tout ?'},
            {id:'decl',label:'Élément déclencheur',ph:'Quel événement brise l\'équilibre initial ?'},
            {id:'refus',label:'Refus de l\'appel',ph:'Pourquoi hésite-t-il à s\'engager ?'},
            {id:'mentor',label:'Rencontre / mentor',ph:'Qui l\'aide à franchir le seuil ?'}]},
    {id:'a2a',label:'Acte II-A — Confrontation',sub:'Le protagoniste entre dans un nouveau monde et affronte des épreuves',
     blocs:[{id:'seuil',label:'Franchissement du seuil',ph:'Il s\'engage — qu\'est-ce qui change ?'},
            {id:'allies',label:'Alliés & ennemis',ph:'Qui rencontre-t-il ? Qui est de quel côté ?'},
            {id:'epreuves',label:'Épreuves & obstacles',ph:'Quelles difficultés croissantes ?'},
            {id:'cave',label:'Approche de la caverne',ph:'Le plus grand danger approche — quelle préparation ?'}]},
    {id:'mid',label:'Midpoint',sub:'Faux triomphe ou fausse défaite — tout bascule ici',
     blocs:[{id:'midpt',label:'Point médian',ph:'Quelle révélation ou retournement à mi-chemin ?'}]},
    {id:'a2b',label:'Acte II-B — Transformation',sub:'Tout s\'effondre, mais le protagoniste se transforme',
     blocs:[{id:'epreuve',label:'Épreuve centrale',ph:'La pire épreuve — mort symbolique ou réelle ?'},
            {id:'recomp',label:'Récompense',ph:'Ce qu\'il obtient en survivant à l\'épreuve'},
            {id:'route',label:'Le chemin du retour',ph:'Décision de revenir ou de terminer la quête'}]},
    {id:'a3',label:'Acte III — Résolution',sub:'Climax et nouveau monde',
     blocs:[{id:'resurr',label:'Résurrection',ph:'Dernier obstacle — transformation définitive'},
            {id:'climax',label:'Climax',ph:'L\'affrontement final — comment se résout-il ?'},
            {id:'retour',label:'Retour avec l\'élixir',ph:'Qu\'est-ce qui a changé ? Quel est le monde nouveau ?'}]}
  ];
  c.innerHTML='';
  ACTES.forEach((acte,ai)=>{
    const div=document.createElement('div'); div.className='struct-acte';
    div.innerHTML=`<div class="struct-acte-titre"><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink4)">${ai+1}</span>${acte.label}</div>
      <div class="struct-acte-sub">${acte.sub}</div>`;
    acte.blocs.forEach(b=>{
      const bd=document.createElement('div'); bd.className='struct-block';
      const val=P.struct[b.id]||'';
      bd.innerHTML=`<div class="struct-block-label">${b.label}</div>
        <textarea placeholder="${b.ph}" oninput="P.struct['${b.id}']=this.value">${val}</textarea>`;
      div.appendChild(bd);
    });
    c.appendChild(div);
    if(ai<ACTES.length-1){
      const sep=document.createElement('div'); sep.className='struct-divider';
      c.appendChild(sep);
    }
  });
}

// ── Carnet auteur ─────────────────────────────────────────
let CA = { idees:[], nid:1 };
let carnetFiInput=null;

export function toggleCarnet(){ ouvrirCarnetPage(); }

export function renderCarnetList(){
  const list=document.getElementById('carnet-list'); list.innerHTML='';
  const stLabel={germe:'Germe',dev:'En développement',ecrire:'À écrire'};
  CA.idees.forEach((id,i)=>{
    const d=document.createElement('div'); d.className='carnet-item'+(carnetActif===i?' on':'');
    const st=id.statut||'germe';
    d.innerHTML=`<div class="carnet-item-titre">${id.titre||'Sans titre'}</div>
      <div class="carnet-item-st st-${st}">${stLabel[st]||st}</div>`;
    d.onclick=()=>{ carnetActif=i; renderCarnetList(); renderCarnetEditor(i); };
    list.appendChild(d);
  });
}

function renderCarnetEditor(i){
  const ed=document.getElementById('carnet-editor');
  const id=CA.idees[i];
  ed.innerHTML=`
    <div id="carnet-header">
      <input id="carnet-titre-input" value="${esc(id.titre||'')}" placeholder="Titre de l'idée…"
        oninput="CA.idees[${i}].titre=this.value;renderCarnetList()">
      <div id="carnet-meta">
        <select id="carnet-statut" onchange="CA.idees[${i}].statut=this.value;renderCarnetList()">
          <option value="germe" ${(id.statut||'germe')==='germe'?'selected':''}>Germe</option>
          <option value="dev" ${id.statut==='dev'?'selected':''}>En développement</option>
          <option value="ecrire" ${id.statut==='ecrire'?'selected':''}>À écrire</option>
        </select>
        <input id="carnet-genre-input" placeholder="genre…" value="${esc(id.genre||'')}"
          oninput="CA.idees[${i}].genre=this.value">
        <button onclick="carnetSupprimer(${i})" style="margin-left:auto;background:none;border:none;font-size:12px;color:var(--accent);cursor:pointer;font-family:'Crimson Pro',serif">Supprimer</button>
      </div>
    </div>
    <div id="carnet-body">
      <div class="carnet-section">
        <div class="carnet-section-label">Prémisse</div>
        <textarea class="carnet-field" placeholder="En une phrase : qui veut quoi contre quoi ?" oninput="CA.idees[${i}].premisse=this.value">${esc(id.premisse||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">L'idée centrale</div>
        <textarea class="carnet-field" placeholder="Quelle est l'étincelle ? D'où vient cette idée ?" oninput="CA.idees[${i}].idee=this.value" style="min-height:90px">${esc(id.idee||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Thèmes & questions</div>
        <textarea class="carnet-field" placeholder="Quels thèmes veux-tu explorer ? Quelles questions sans réponse ?" oninput="CA.idees[${i}].themes=this.value">${esc(id.themes||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Personnages pressentis</div>
        <textarea class="carnet-field" placeholder="Qui peuple ce roman ? Même des ébauches…" oninput="CA.idees[${i}].persos=this.value">${esc(id.persos||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Références & inspirations</div>
        <textarea class="carnet-field" placeholder="Livres, films, souvenirs, phrases entendues…" oninput="CA.idees[${i}].refs=this.value">${esc(id.refs||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Notes libres</div>
        <textarea class="carnet-field" placeholder="Tout le reste — fragments, dialogues, images…" oninput="CA.idees[${i}].notes=this.value" style="min-height:120px">${esc(id.notes||'')}</textarea>
      </div>
    </div>`;
}

export function carnetNouveau(){
  CA.idees.push({id:CA.nid++,titre:'',statut:'germe',genre:'',premisse:'',idee:'',themes:'',persos:'',refs:'',notes:''});
  carnetActif=CA.idees.length-1;
  renderCarnetList();
  renderCarnetEditor(carnetActif);
  setTimeout(()=>document.getElementById('carnet-titre-input')?.focus(),50);
}

export function carnetSupprimer(i){
  if(!confirm('Supprimer cette idée ?')) return;
  CA.idees.splice(i,1);
  carnetActif=CA.idees.length>0?Math.min(i,CA.idees.length-1):null;
  renderCarnetList();
  if(carnetActif!==null) renderCarnetEditor(carnetActif);
  else document.getElementById('carnet-editor').innerHTML=`<div id="carnet-empty"><p>Sélectionnez une idée ou créez-en une nouvelle</p><button class="fb fb-s" style="max-width:180px" onclick="carnetNouveau()">+ Nouvelle idée</button></div>`;
}

export function carnetSauvegarder(){
  const b=new Blob([JSON.stringify(CA,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download='mon_carnet.auteur'; a.click(); flash('Carnet sauvegardé ✓');
}

function carnetCharger(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.auteur';
  inp.onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{ try{ CA=JSON.parse(ev.target.result); carnetActif=CA.idees.length>0?0:null; renderCarnetList(); if(carnetActif!==null) renderCarnetEditor(0); flash('Carnet chargé ✓'); }catch{ alert('Fichier invalide.'); }};
    r.readAsText(f);
  };
  inp.click();
}

// ── Recherche occurrences ─────────────────────────────────
export function chercherOccurrences(nom){
  const resultats=[];
  const re=new RegExp(nom.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
  P.chapitres.forEach((ch,ci)=>{
    const div=document.createElement('div');
    div.innerHTML=ch.contenu||'';
    const txt=div.innerText||'';
    let m;
    while((m=re.exec(txt))!==null){
      const start=Math.max(0,m.index-40);
      const end=Math.min(txt.length,m.index+nom.length+40);
      let ctx=txt.slice(start,end).replace(/\n/g,' ');
      if(start>0) ctx='…'+ctx;
      if(end<txt.length) ctx=ctx+'…';
      resultats.push({ci,titre:ch.titre,ctx,idx:m.index});
    }
  });
  return resultats;
}

function afficherOccurrences(nom){
  // Retirer ancienne section si existe
  document.querySelectorAll('.occ-section').forEach(el=>el.remove());
  const res=chercherOccurrences(nom);
  if(!res.length) return;
  const sec=document.createElement('div');
  sec.className='occ-section';
  sec.innerHTML=`<div class="occ-title">Apparaît dans ${res.length} passage${res.length>1?'s':''}</div>`;
  res.forEach(r=>{
    const d=document.createElement('div');
    d.className='occ-item';
    d.innerHTML=`<div class="occ-chap">Chapitre ${r.ci+1} — ${r.titre}</div><div class="occ-ctx">${r.ctx}</div>`;
    d.onclick=()=>{
      if(planMode) togglePlan();
      save(); loadChap(r.ci);
      flash('↓ Chapitre '+( r.ci+1));
    };
    sec.appendChild(d);
  });
  document.getElementById('pf').appendChild(sec);
}

// ── Accordéons panel ──────────────────────────────────────
let accOuvert = 'perso';

export function accToggle(which){
  if(accOuvert === which){
    // Fermer
    document.getElementById('acc-'+which).style.display='none';
    document.getElementById('arr-'+which).textContent='▸';
    accOuvert = null;
  } else {
    // Fermer l'ancien
    if(accOuvert){
      document.getElementById('acc-'+accOuvert).style.display='none';
      document.getElementById('arr-'+accOuvert).textContent='▸';
    }
    accOuvert = which;
    document.getElementById('acc-'+which).style.display='block';
    document.getElementById('arr-'+which).textContent='▾';
    renderAcc(which);
  }
  document.getElementById('pf').style.display='none';
  editId=null; photoTmp=null;
}

function renderAcc(which){
  const c=document.getElementById('acc-'+which);
  c.innerHTML='';
  if(which==='perso') renderAccPerso(c);
  else if(which==='lieux') renderAccLieux(c);
  else if(which==='time') renderAccTime(c);
  else renderAccNotes(c);
}

function renderAccPerso(c){
  const wrap=document.createElement('div'); wrap.className='psec';
  const hdr=document.createElement('div'); hdr.className='psec-t';
  hdr.innerHTML=`Personnages <button class="icon-btn" onclick="openNew('perso')" style="font-size:13px">＋</button>`;
  wrap.appendChild(hdr);
  if(!P.personnages.length){ wrap.innerHTML+=emptyMsg(); }
  P.personnages.forEach(p=>{
    const el=document.createElement('div'); el.className='card';
    const av=p.photo?`<div class="avatar"><img src="${p.photo}"></div>`:`<div class="avatar">👤</div>`;
    el.innerHTML=av+`<div class="cb"><div class="cn">${p.nom}</div><div class="cs">${p.role||''}</div>${p.age?`<span class="ctag">${p.age}</span>`:''}</div>`;
    el.onclick=()=>openEdit('perso',p); wrap.appendChild(el);
  });
  c.appendChild(wrap);
}

function renderAccLieux(c){
  const wrap=document.createElement('div'); wrap.className='psec';
  const hdr=document.createElement('div'); hdr.className='psec-t';
  hdr.innerHTML=`Lieux <button class="icon-btn" onclick="openNew('lieu')" style="font-size:13px">＋</button>`;
  wrap.appendChild(hdr);
  if(!P.lieux.length){ wrap.innerHTML+=emptyMsg(); }
  P.lieux.forEach(l=>{
    const el=document.createElement('div'); el.className='card';
    el.innerHTML=`<div class="avatar">📍</div><div class="cb"><div class="cn">${l.nom}</div><div class="cs">${l.type||''}</div>${l.epoque?`<span class="ctag">${l.epoque}</span>`:''}</div>`;
    el.onclick=()=>openEdit('lieu',l); wrap.appendChild(el);
  });
  c.appendChild(wrap);
}

function renderAccTime(c){
  const wrap=document.createElement('div'); wrap.className='psec';
  const hdr=document.createElement('div'); hdr.className='psec-t';
  hdr.innerHTML=`Événements <button class="icon-btn" onclick="openNew('tl')" style="font-size:13px">＋</button>`;
  wrap.appendChild(hdr);
  if(!P.timeline.length){ wrap.innerHTML+=emptyMsg(); }
  P.timeline.forEach(ev=>{
    const el=document.createElement('div'); el.className='tli';
    el.innerHTML=`<div class="tl-d">${ev.date||'—'}</div><div class="tl-t">${ev.titre}</div>${ev.persos?`<div class="tl-p">${ev.persos}</div>`:''}`;
    el.onclick=()=>openEdit('tl',ev); c.appendChild(el);
  });
  c.appendChild(wrap);
}

function renderAccNotes(c){
  const wrap=document.createElement('div');
  wrap.style.cssText='padding:11px 13px 14px;';
  const ta=document.createElement('textarea');
  ta.style.cssText='width:100%;background:var(--paper);border:1px solid var(--paper3);border-radius:4px;padding:8px 10px;font-family:"Crimson Pro",serif;font-size:14px;color:var(--ink);outline:none;resize:none;min-height:220px;line-height:1.65;';
  ta.placeholder='Notes libres sur ce roman…';
  ta.value=P.notesLibres||'';
  ta.addEventListener('input',()=>{ P.notesLibres=ta.value; });
  wrap.appendChild(ta);
  c.appendChild(wrap);
}

function renderPanel(){ if(accOuvert) renderAcc(accOuvert); }


function mkSec(label,type){
  const d=document.createElement('div'); d.className='psec';
  d.innerHTML=`<div class="psec-t">${label} <button class="icon-btn" onclick="openNew('${type}')" style="font-size:13px">＋</button></div>`;
  return d;
}
function emptyMsg(){ return `<div style="font-size:13px;color:var(--ink4);font-style:italic;padding:6px 0">Aucun élément. Clic droit sur du texte sélectionné pour en ajouter.</div>`; }

// ── Formulaires ───────────────────────────────────────────
export function openNew(type, prefill){
  editId=null; photoTmp=null;
  if(type==='perso' && accOuvert!=='perso') accToggle('perso');
  else if(type==='lieu' && accOuvert!=='lieux') accToggle('lieux');
  else if(type==='tl' && accOuvert!=='time') accToggle('time');
  showForm(type, {nom:type!=='tl'?(prefill||''):'', titre:prefill||''});
}

export function openEdit(type, obj){
  editId=obj.id; photoTmp=obj.photo||null;
  showForm(type, obj);
  // Chercher occurrences du nom dans le texte
  const nom=obj.nom||(type==='tl'?obj.titre:'');
  if(nom) setTimeout(()=>afficherOccurrences(nom),50);
}

export function showForm(type, obj){
  const f=document.getElementById('pf'); f.style.display='block';
  let h='';
  if(type==='perso'){
    const src=photoTmp||obj.photo||'';
    h=`<h4>${editId?'Modifier':'Nouveau'} personnage</h4>
    <div class="pz">
      <div class="pp" id="pp">${src?`<img src="${src}">`:'👤'}</div>
      <div>
        <button class="pb" onclick="document.getElementById('pi').click()">Choisir photo</button>
        ${src?`<button class="pb" onclick="delPhoto()" style="margin-top:4px;color:var(--accent)">Retirer</button>`:''}
      </div>
    </div>
    <label class="fl">Nom</label><input class="fi" id="f1" value="${esc(obj.nom||'')}">
    <label class="fl">Rôle</label><input class="fi" id="f2" value="${esc(obj.role||'')}">
    <label class="fl">Âge</label><input class="fi" id="f3" value="${esc(obj.age||'')}">
    <label class="fl">Notes</label><textarea class="fi fta" id="f4">${esc(obj.notes||'')}</textarea>`;
  } else if(type==='lieu'){
    h=`<h4>${editId?'Modifier':'Nouveau'} lieu</h4>
    <label class="fl">Nom</label><input class="fi" id="f1" value="${esc(obj.nom||'')}">
    <label class="fl">Type</label><input class="fi" id="f2" value="${esc(obj.type||'')}">
    <label class="fl">Époque</label><input class="fi" id="f3" value="${esc(obj.epoque||'')}">
    <label class="fl">Notes</label><textarea class="fi fta" id="f4">${esc(obj.notes||'')}</textarea>`;
  } else {
    h=`<h4>${editId?'Modifier':'Nouvel'} événement</h4>
    <label class="fl">Titre</label><input class="fi" id="f1" value="${esc(obj.titre||obj.nom||'')}">
    <label class="fl">Date / Moment</label><input class="fi" id="f2" placeholder="Jour 3, Été 1842…" value="${esc(obj.date||'')}">
    <label class="fl">Personnages</label><input class="fi" id="f3" value="${esc(obj.persos||'')}">
    <label class="fl">Notes</label><textarea class="fi fta" id="f4">${esc(obj.notes||'')}</textarea>`;
  }
  h+=`<div class="fbr">
    <button class="fb fb-s" onclick="saveForm('${type}')">Sauvegarder</button>
    <button class="fb fb-c" onclick="closeForm()">Annuler</button>
  </div>`;
  if(editId) h+=`<div style="margin-top:8px;text-align:right"><button onclick="delItem('${type}')" style="background:none;border:none;font-size:12px;color:var(--accent);cursor:pointer;font-family:'Crimson Pro',serif">Supprimer</button></div>`;
  f.innerHTML=h;
  setTimeout(()=>{ const n=document.getElementById('f1'); if(n)n.focus(); },40);
}

export function closeForm(){
  document.getElementById('pf').style.display='none';
  editId=null; photoTmp=null;
  renderPanel();
}

function photoLue(input){
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=(e)=>{
    photoTmp=e.target.result;
    const pp=document.getElementById('pp');
    if(pp) pp.innerHTML=`<img src="${photoTmp}">`;
  };
  r.readAsDataURL(file); input.value='';
}
function delPhoto(){ photoTmp=null; const pp=document.getElementById('pp'); if(pp) pp.innerHTML='👤'; }

export function saveForm(type){
  const nom=(document.getElementById('f1')?.value||'').trim();
  if(!nom){ flash('Le nom ne peut pas être vide.'); return; }
  const c2=(document.getElementById('f2')?.value||'').trim();
  const c3=(document.getElementById('f3')?.value||'').trim();
  const notes=(document.getElementById('f4')?.value||'').trim();
  if(type==='perso'){
    if(editId){ const x=P.personnages.find(p=>p.id===editId); if(x){x.nom=nom;x.role=c2;x.age=c3;x.notes=notes;x.photo=photoTmp!==null?photoTmp:x.photo;} }
    else P.personnages.push({id:P.nid++,nom,role:c2,age:c3,notes,photo:photoTmp});
  } else if(type==='lieu'){
    if(editId){ const x=P.lieux.find(l=>l.id===editId); if(x){x.nom=nom;x.type=c2;x.epoque=c3;x.notes=notes;} }
    else P.lieux.push({id:P.nid++,nom,type:c2,epoque:c3,notes});
  } else {
    if(editId){ const x=P.timeline.find(t=>t.id===editId); if(x){x.titre=nom;x.date=c2;x.persos=c3;x.notes=notes;} }
    else P.timeline.push({id:P.nid++,titre:nom,date:c2,persos:c3,notes});
  }
  closeForm(); renderPanel(); flash('Sauvegardé ✓');
}

export function delItem(type){
  if(!editId||!confirm('Supprimer ?')) return;
  if(type==='perso') P.personnages=P.personnages.filter(x=>x.id!==editId);
  else if(type==='lieu') P.lieux=P.lieux.filter(x=>x.id!==editId);
  else P.timeline=P.timeline.filter(x=>x.id!==editId);
  editId=null; closeForm(); renderPanel();
}

// ── Clic droit ────────────────────────────────────────────
export function showCtx(e){
  const sel=window.getSelection();
  if(!sel||!sel.toString().trim()) return;
  e.preventDefault();
  ctxSel=sel.toString().trim();
  const m=document.getElementById('ctx');
  m.style.display='block';
  m.style.left=Math.min(e.clientX,window.innerWidth-215)+'px';
  m.style.top=Math.min(e.clientY,window.innerHeight-155)+'px';
}
export function ctxDo(t){
  document.getElementById('ctx').style.display='none';
  if(t==='copy'){document.execCommand('copy');return;}
  openNew(t,ctxSel);
}

// ── Sauvegarde fichier ────────────────────────────────────
export async function partagerLecture(){
  if(!P.projet_cloud_id){
    alert('Ouvrez d\'abord un projet depuis le tableau de bord, puis sauvegardez dans le cloud ☁');
    return;
  }
  const { error } = await sb.from('projets')
    .update({ partage: true })
    .eq('id', P.projet_cloud_id)
    .eq('user_id', sbUser.id);
  if(error){ flash('Erreur : ' + error.message); return; }
  const lien = `https://iletaitunefois.net/thermidor/lecture.html?p=${P.projet_cloud_id}`;
  navigator.clipboard.writeText(lien).catch(()=>{});
  prompt('Lien de lecture copié — partagez-le à vos bêtas :', lien);
  flash('Projet partagé ✓');
}

export function sauvegarderLocal(){
  save();
  const b=new Blob([JSON.stringify(P,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b);
  a.download=(P.titre||'roman').replace(/\s+/g,'_')+'.encre';
  a.click(); flash('Copie locale téléchargée ✓');
}
export function charger(){ document.getElementById('fi').click(); }
function ouvrir(input){
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=(e)=>{
    try{ P=JSON.parse(e.target.result); document.getElementById('projet-nom').value=P.titre; chapI=0; loadChap(0); renderPanel(); updateSbProjet(); flash('Chargé : '+P.titre); }
    catch{ alert('Fichier invalide.'); }
  };
  r.readAsText(file); input.value='';
}
export function importerDocx(){ document.getElementById('fi-docx').click(); }

export async function lireDocx(input){
  const file=input.files[0]; if(!file) return;
  input.value='';
  if(!confirm('Importer ce fichier Word ? Le projet actuel sera remplacé.\n\nLes Titre 1 = nouveaux chapitres, Titre 2 = sous-titres de chapitre.')) return;

  try{
    if(typeof JSZip==='undefined') throw new Error('JSZip non chargé — connexion internet requise.');
    flash('Lecture du fichier…');

    const ab=await file.arrayBuffer();
    const zip=await JSZip.loadAsync(ab);

    // Lire document.xml
    const docXmlStr=await zip.file('word/document.xml').async('string');
    const parser=new DOMParser();
    const doc=parser.parseFromString(docXmlStr,'text/xml');

    // Lire styles.xml pour mapper styleId → nom normalisé
    let styleMap={};
    const stylesFile=zip.file('word/styles.xml');
    if(stylesFile){
      const stylesStr=await stylesFile.async('string');
      const stylesDoc=parser.parseFromString(stylesStr,'text/xml');
      stylesDoc.querySelectorAll('style').forEach(s=>{
        const id=s.getAttribute('w:styleId')||'';
        const nameEl=s.querySelector('name');
        const name=(nameEl?.getAttribute('w:val')||'').toLowerCase();
        styleMap[id.toLowerCase()]=name;
      });
    }

    function getStyleName(pEl){
      const styleEl=pEl.querySelector('pStyle');
      if(!styleEl) return '';
      const id=(styleEl.getAttribute('w:val')||'').toLowerCase();
      // D'abord chercher dans styleMap
      if(styleMap[id]) return styleMap[id];
      // Sinon utiliser l'id directement
      return id;
    }

    function isHeading1(name){ return /heading\s*1|titre\s*1|heading1/.test(name); }
    function isHeading2(name){ return /heading\s*2|titre\s*2|heading2/.test(name); }

    // Extraire le texte d'un paragraphe en conservant gras/italique
    function paraToHtml(pEl){
      let html='';
      pEl.querySelectorAll('r').forEach(r=>{
        const rPr=r.querySelector('rPr');
        const bold=rPr?.querySelector('b')&&!rPr?.querySelector('b[w\\:val="false"]');
        const italic=rPr?.querySelector('i')&&!rPr?.querySelector('i[w\\:val="false"]');
        const underline=rPr?.querySelector('u[w\\:val]:not([w\\:val="none"])');
        let txt='';
        r.querySelectorAll('t').forEach(t=>{ txt+=t.textContent; });
        if(!txt) return;
        const escaped=txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        let span=escaped;
        if(bold) span=`<strong>${span}</strong>`;
        if(italic) span=`<em>${span}</em>`;
        if(underline) span=`<u>${span}</u>`;
        html+=span;
      });
      return html;
    }

    // Parcourir les paragraphes et construire les chapitres
    const chapitres=[];
    let chapCourant=null;
    let chapNiveau=2;
    let contenuCourant=[];

    const paragraphes=doc.querySelectorAll('body > p, body p');
    paragraphes.forEach(p=>{
      const styleName=getStyleName(p);
      const texte=p.textContent.trim();

      if(isHeading1(styleName)||isHeading2(styleName)){
        if(chapCourant!==null){
          chapitres.push({id:P.nid++, titre:chapCourant, contenu:contenuCourant.join(''), mots:0, niveau:chapNiveau});
        }
        chapCourant=texte||'Sans titre';
        chapNiveau=isHeading1(styleName)?1:2;
        contenuCourant=[];
      } else {
        // Texte normal
        if(chapCourant===null){ chapCourant='Chapitre I'; }
        const html=paraToHtml(p);
        if(html) contenuCourant.push(`<p>${html}</p>`);
      }
    });

    // Dernier chapitre
    if(chapCourant!==null){
      chapitres.push({id:P.nid++, titre:chapCourant, contenu:contenuCourant.join(''), mots:0, niveau:chapNiveau});
    }

    if(!chapitres.length){
      flash('Aucun chapitre détecté — vérifiez que les titres utilisent les styles Titre 1/Titre 2 dans Word.');
      return;
    }

    // Calculer les mots
    chapitres.forEach(ch=>{
      const div=document.createElement('div'); div.innerHTML=ch.contenu;
      const t=div.innerText.trim();
      ch.mots=t?t.split(/\s+/).length:0;
    });

    // Mettre à jour le projet
    const nomFichier=file.name.replace(/\.docx$/i,'');
    P.titre=nomFichier;
    P.chapitres=chapitres;
    document.getElementById('projet-nom').value=P.titre;
    chapI=0;
    loadChap(0);
    renderPanel();
    updateSbProjet();
    flash(`Importé : ${chapitres.length} chapitre${chapitres.length>1?'s':''} ✓`);

  } catch(err){
    alert('Erreur import : '+err.message);
  }
}

export function nouveauProjet(){
  if(!confirm('Nouveau projet ? Sauvegardez d\'abord si besoin.')) return;
  P={titre:'Nouveau Roman',auteur:'',sousTitre:'',genre:'',annee:new Date().getFullYear()+'',synopsis:'',chapitres:[{id:1,titre:'Chapitre I',contenu:'',mots:0}],personnages:[],lieux:[],timeline:[],nid:2,projet_cloud_id:null};
  document.getElementById('projet-nom').value=P.titre;
  document.getElementById('dashboard').classList.remove('on');
  fermerCarnetPage();
  setNavActive(null);
  chapI=0; loadChap(0); renderPanel(); updateSbProjet();
}

// ── Export TXT ────────────────────────────────────────────
