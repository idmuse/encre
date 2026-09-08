// ── Export PDF, DOCX, TXT ────────────────────────────────
import { getP, getCI, totalMotsProjet } from './state.js';
import { flash, dl, rom, esc } from './utils.js';

function exportTxt(){
  save();
  let t=P.titre+'\n'+'═'.repeat(P.titre.length)+'\n\n';
  P.chapitres.forEach((c,i)=>{
    t+=rom(i+1)+'. '+c.titre+'\n'+'─'.repeat(38)+'\n\n';
    const d=document.createElement('div'); d.innerHTML=c.contenu;
    t+=(d.innerText||'')+'\n\n';
  });
  dl(new Blob([t],{type:'text/plain;charset=utf-8'}), (P.titre||'roman').replace(/\s+/g,'_')+'.txt');
}

// ── Export DOCX (sans CDN externe, via JSZip) ─────────────
// ── EXPORT PDF KDP 6×9" ───────────────────────────────────
export async function exportPdf(){
  save();
  const btn = document.getElementById('btn-pdf');
  btn.textContent = '⟳ PDF…'; btn.disabled = true;
  flash('Génération PDF…');

  try {
    const { jsPDF } = window.jspdf;
    const W = 152.4, H = 228.6; // 6×9" en mm
    const mGout = 19.05, mExt = 12.7, mHaut = 19.05, mBas = 22.23;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:[W,H] });

    const titre = P.titre || 'Roman';
    const auteur = P.auteur || '';
    let pageNum = 0;

    function mL(){ return pageNum%2!==0 ? mGout : mExt; }
    function mR(){ return W - (pageNum%2!==0 ? mExt : mGout); }
    function tW(){ return mR() - mL(); }

    function numPage(){
      if(pageNum > 2){
        doc.setFont('Times','normal'); doc.setFontSize(9); doc.setTextColor(80);
        doc.text(String(pageNum-2), W/2, H-8, {align:'center'});
        doc.setTextColor(0);
      }
    }

    function nouvellePage(){
      doc.addPage(); pageNum++;
    }

    function pageImpaire(){
      if(pageNum%2===0) nouvellePage();
    }

    // Page 1 — titre
    pageNum=1;
    doc.setFont('Times','italic'); doc.setFontSize(28);
    doc.text(titre, W/2, 80, {align:'center'});
    doc.setFont('Times','normal'); doc.setFontSize(12);
    doc.text(auteur, W/2, 95, {align:'center'});

    // Page 2 — infos
    nouvellePage();
    doc.setFont('Times','bold'); doc.setFontSize(12);
    doc.text(titre, W/2, mHaut+10, {align:'center'});
    doc.setFont('Times','normal'); doc.setFontSize(11);
    doc.text(auteur, W/2, mHaut+20, {align:'center'});
    if(P.genre||P.annee) doc.text(`${P.genre||''}${P.genre&&P.annee?' · ':''}${P.annee||''}`, W/2, mHaut+28, {align:'center'});
    numPage();

    // Chapitres
    let chapNum = 0;
    P.chapitres.forEach((ch) => {
      const niv = ch.niveau||2;
      nouvellePage(); pageImpaire();

      if(niv===1){
        // Page de partie — titre + sous-titre éventuel
        numPage();
        doc.setFont('Times','normal'); doc.setFontSize(22);
        doc.text((ch.titre||'').toUpperCase(), W/2, H/3, {align:'center'});
        if(ch.contenu){
          const tmp=document.createElement('div'); tmp.innerHTML=ch.contenu;
          const st=tmp.innerText.trim();
          if(st && st.length<120){
            doc.setFont('Times','italic'); doc.setFontSize(14);
            doc.text(doc.splitTextToSize(st,tW()), W/2, H/3+14, {align:'center'});
          }
        }
        return;
      }

      // Chapitre (niveau 2) — on affiche ch.titre tel quel comme en-tête
      chapNum++;
      numPage();
      doc.setFont('Times','normal'); doc.setFontSize(18);
      doc.text((ch.titre||String(chapNum)), W/2, mHaut+18, {align:'center'});
      if(!ch.contenu) return;

      const tmp=document.createElement('div'); tmp.innerHTML=ch.contenu;

      // Extraire les segments avec leur style depuis un nœud DOM
      function extraireSegments(noeud){
        const segs=[];
        function parcourir(n, bold, italic){
          if(n.nodeType===3){
            const t=n.textContent;
            if(t) segs.push({t, bold, italic});
          } else if(n.nodeType===1){
            const tag=n.tagName.toLowerCase();
            const b=bold||tag==='b'||tag==='strong';
            const i=italic||tag==='em'||tag==='i';
            n.childNodes.forEach(c=>parcourir(c,b,i));
          }
        }
        parcourir(noeud,false,false);
        return segs;
      }

      // Construire la liste de paragraphes, chacun = {segs, align} ou {type:'texto', cote, nom, msg}
      const paras=[];
      tmp.childNodes.forEach(n=>{
        if(n.classList?.contains('texto-bloc')){
          const cote=n.getAttribute('data-texto')||'gauche';
          const nom=(n.querySelector('.texto-nom')?.innerText||'').trim();
          const msg=(n.querySelector('.texto-msg')?.innerText||'').trim();
          if(msg) paras.push({type:'texto', cote, nom, msg});
          return;
        }
        const segs=extraireSegments(n);
        const texte=segs.map(s=>s.t).join('').trim();
        if(!texte) return;
        const styleAlign=(n.style?.textAlign||'').toLowerCase();
        const align=styleAlign==='center'?'center':styleAlign==='right'?'right':'justify';
        paras.push({segs, align});
      });

      doc.setFont('Times','normal'); doc.setFontSize(11);
      let y=mHaut+40, first=true;

      // Écrire une ligne avec segments stylisés, justifiée ou non
      function ecrireLigne(segsDeLigne, xBase, largeurDispo, justifier){
        // Aplatir en mots avec leur style
        const mots=[];
        segsDeLigne.forEach(seg=>{
          const style=(seg.bold&&seg.italic)?'bolditalic':seg.bold?'bold':seg.italic?'italic':'normal';
          // Séparer sur les espaces en gardant les espaces
          const parties=seg.t.split(/( +)/);
          parties.forEach(p=>{
            if(p==='') return;
            if(/^ +$/.test(p)){
              if(mots.length>0) mots[mots.length-1].apresEspace=(mots[mots.length-1].apresEspace||0)+p.length;
            } else {
              mots.push({mot:p, style, apresEspace:0});
            }
          });
        });
        if(!mots.length) return;

        if(justifier && mots.length>1){
          // Calculer largeur totale des mots
          let largeurMots=0;
          mots.forEach(m=>{ doc.setFont('Times',m.style); largeurMots+=doc.getTextWidth(m.mot); });
          const espaceTotal=largeurDispo-largeurMots;
          const espaceParGap=espaceTotal/(mots.length-1);
          let x=xBase;
          mots.forEach((m,mi)=>{
            doc.setFont('Times',m.style);
            doc.text(m.mot, x, y);
            x+=doc.getTextWidth(m.mot);
            if(mi<mots.length-1) x+=espaceParGap;
          });
        } else {
          let x=xBase;
          mots.forEach(m=>{
            doc.setFont('Times',m.style);
            doc.text(m.mot, x, y);
            x+=doc.getTextWidth(m.mot);
            if(m.apresEspace){
              doc.setFont('Times','normal');
              x+=doc.getTextWidth(' ')*m.apresEspace;
            }
          });
        }
        doc.setFont('Times','normal');
      }

      // Découper un paragraphe (segments) en lignes en tenant compte des styles
      function decouperEnLignes(segs, largeur){
        const lignes=[];
        let ligneCourante=[], largeurCourante=0, premierMot=true;
        function ajouterMot(mot, style, dernier){
          doc.setFont('Times',style);
          const lMot=doc.getTextWidth(mot);
          const lEspace=premierMot?0:doc.getTextWidth(' ');
          if(!premierMot && largeurCourante+lEspace+lMot>largeur+0.01){
            lignes.push({segs:ligneCourante, fin:false});
            ligneCourante=[{t:mot,style}];
            largeurCourante=lMot;
            premierMot=false;
          } else {
            if(!premierMot) largeurCourante+=lEspace;
            ligneCourante.push({t:mot,style,space:!premierMot});
            largeurCourante+=lMot;
            premierMot=false;
          }
        }
        segs.forEach(seg=>{
          const style=(seg.bold&&seg.italic)?'bolditalic':seg.bold?'bold':seg.italic?'italic':'normal';
          // Tokeniser : mots et espaces
          seg.t.split(/(\s+)/).forEach(tok=>{
            if(!tok) return;
            if(/^\s+$/.test(tok)){
              // espace entre mots — géré dans ajouterMot
            } else {
              // Peut contenir des espaces internes ? Non après split
              ajouterMot(tok, style, false);
            }
          });
        });
        if(ligneCourante.length) lignes.push({segs:ligneCourante, fin:true});
        // Marquer la vraie dernière ligne
        if(lignes.length) lignes[lignes.length-1].fin=true;
        return lignes;
      }

      paras.forEach(para=>{
        // ── Bulle texto ──────────────────────────────────────
        if(para.type==='texto'){
          const droite=para.cote==='droite';
          const maxBulle=tW()*0.62; // bulle max 62% de la largeur
          doc.setFont('Times','normal'); doc.setFontSize(9);
          const lignesMsg=doc.splitTextToSize(para.msg, maxBulle-6);
          const lignesNom=para.nom ? doc.splitTextToSize(para.nom, maxBulle-6) : [];
          const hauteurContenu=(lignesNom.length*4.5)+(lignesMsg.length*4.5)+5;
          const largeurBulle=Math.min(maxBulle, doc.getTextWidth(para.msg)+10);
          // Recalculer avec la vraie largeur
          const lignesMsgF=doc.splitTextToSize(para.msg, largeurBulle-6);
          const hautF=(lignesNom.length>0?4.5:0)+(lignesMsgF.length*4.5)+5;

          if(y+hautF>H-mBas-5){
            numPage(); nouvellePage(); numPage();
            doc.setFont('Times','normal'); doc.setFontSize(11); doc.setTextColor(0);
            y=mHaut+6;
          }

          const xBulle=droite ? mL()+tW()-largeurBulle : mL();

          // Rectangle bulle (fond léger)
          doc.setFillColor(droite?220:240, droite?230:240, droite?245:240);
          doc.setDrawColor(180,180,180);
          doc.roundedRect(xBulle, y-3, largeurBulle, hautF, 2, 2, 'FD');

          // Nom expéditeur
          let yy=y+1;
          if(para.nom){
            doc.setFont('Times','bolditalic'); doc.setFontSize(8); doc.setTextColor(100,100,100);
            doc.text(para.nom, xBulle+3, yy);
            yy+=4.5;
          }
          // Message
          doc.setFont('Times','normal'); doc.setFontSize(9); doc.setTextColor(30,30,30);
          lignesMsgF.forEach(l=>{ doc.text(l, xBulle+3, yy); yy+=4.5; });
          doc.setTextColor(0);

          y+=hautF+3;
          first=false;
          return;
        }
        const {segs, align} = para;
        const ind=(first && align==='justify')?0:7;
        // Pour centré/droite : pas d'indentation, pas de justification
        const larg= align==='justify' ? tW()-ind : tW();
        const lignes=decouperEnLignes(segs, larg);

        lignes.forEach((ligne,li)=>{
          if(y>H-mBas-5){
            numPage(); nouvellePage(); numPage();
            doc.setFont('Times','normal'); doc.setFontSize(11); doc.setTextColor(0);
            y=mHaut+6;
          }

          if(align==='center' || align==='right'){
            // Calculer la largeur réelle de la ligne pour centrer/aligner
            let largLigne=0;
            ligne.segs.forEach((s,si)=>{
              doc.setFont('Times', s.style==='bold'||s.style==='bolditalic'?s.style:s.style==='italic'?'italic':'normal');
              largLigne+=doc.getTextWidth(s.t);
              if(si<ligne.segs.length-1) largLigne+=doc.getTextWidth(' ');
            });
            const xBase= align==='center' ? mL()+(tW()-largLigne)/2 : mL()+tW()-largLigne;
            const segsAvecEspaces=[];
            ligne.segs.forEach((s,si)=>{
              if(si>0) segsAvecEspaces.push({t:' ',bold:false,italic:false});
              segsAvecEspaces.push({t:s.t,bold:s.style==='bold'||s.style==='bolditalic',italic:s.style==='italic'||s.style==='bolditalic'});
            });
            ecrireLigne(segsAvecEspaces, xBase, largLigne, false);
          } else {
            const xBase=mL()+(li===0?ind:0);
            const largeurDispo=tW()-(li===0?ind:0);
            const justifier=!ligne.fin && ligne.segs.length>1;
            const segsAvecEspaces=[];
            ligne.segs.forEach((s,si)=>{
              if(s.space) segsAvecEspaces.push({t:' ',bold:false,italic:false});
              segsAvecEspaces.push({t:s.t,bold:s.style==='bold'||s.style==='bolditalic',italic:s.style==='italic'||s.style==='bolditalic'});
            });
            ecrireLigne(segsAvecEspaces, xBase, largeurDispo, justifier);
          }
          y+=6.5;
        });
        y+=1.5; first=false;
      });
      numPage();
    });

    doc.save((titre.replace(/\s+/g,'_')||'roman')+'_KDP.pdf');
    flash('PDF généré ✓');
  } catch(e){
    flash('Erreur PDF : '+e.message); console.error(e);
  }
  btn.textContent='→ PDF'; btn.disabled=false;
}

export async function exportDocx(){
  save(); // S'assurer que le chapitre actuel est sauvegardé avant export
  save();
  const btn=document.getElementById('btn-docx');
  btn.textContent='→ Génération…'; btn.disabled=true;
  try{
    if(typeof JSZip==='undefined') throw new Error('JSZip non chargé — vérifiez votre connexion internet.');

    // ── Helpers XML ──
    const x=(tag,attrs,inner)=>{
      const a=Object.entries(attrs||{}).map(([k,v])=>` ${k}="${v}"`).join('');
      return inner===undefined?`<${tag}${a}/>`:`<${tag}${a}>${inner}</${tag}>`;
    };
    const esc2=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // ── Convertir nœuds HTML en runs Word XML ──
    function nodeToRuns(node, bold=false, italic=false, underline=false){
      if(node.nodeType===3){
        const txt=node.textContent;
        if(!txt) return '';
        let rPr='';
        if(bold) rPr+='<w:b/>';
        if(italic) rPr+='<w:i/>';
        if(underline) rPr+='<w:u w:val="single"/>';
        rPr+=`<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>`;
        return x('w:r',{},x('w:rPr',{},rPr)+x('w:t',{'xml:space':'preserve'},esc2(txt)));
      }
      const tag=node.nodeName;
      const b2=bold||(tag==='B'||tag==='STRONG');
      const i2=italic||(tag==='I'||tag==='EM');
      const u2=underline||(tag==='U');
      return Array.from(node.childNodes).map(c=>nodeToRuns(c,b2,i2,u2)).join('');
    }

    // ── Construire les paragraphes du corps ──
    function htmlToParagraphs(html, indentFirst=true){
      const div=document.createElement('div');
      div.innerHTML=html||'';
      const paras=[];
      function pTxt(txt,indent){
        const pPr=indent?'<w:ind w:firstLine="720"/><w:spacing w:after="200"/>':'<w:spacing w:after="200"/>';
        return x('w:p',{},x('w:pPr',{},pPr)+x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>') +x('w:t',{'xml:space':'preserve'},esc2(txt))));
      }
      function pSimple(txt){
        return x('w:p',{},x('w:pPr',{},'<w:spacing w:after="100"/>') +x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>') +x('w:t',{'xml:space':'preserve'},esc2(txt))));
      }
      div.childNodes.forEach(node=>{
        // Bloc texto → syntaxe Thermidor
        if(node.nodeType===1&&node.classList&&node.classList.contains('texto-bloc')){
          const cote=node.getAttribute('data-texto')||'gauche';
          const nom=node.querySelector('.texto-nom')?.textContent?.trim()||'';
          const msg=node.querySelector('.texto-msg')?.innerText?.trim()||'';
          paras.push(pSimple(`##${cote}:${nom}`));
          msg.split('\n').forEach(l=>{ if(l.trim()) paras.push(pSimple(l.trim())); });
          paras.push(pSimple('##fin'));
          paras.push(x('w:p',{},x('w:pPr',{},'<w:spacing w:after="100"/>')));
          return;
        }
        // Noeud texte nu
        if(node.nodeType===3){
          const txt=node.textContent.trim();
          if(!txt) return;
          paras.push(pTxt(txt, indentFirst));
          return;
        }
        if(node.nodeName==='BR') return;
        // <div> ou <p> avec seulement un <br> → paragraphe vide, ignorer
        if((node.nodeName==='DIV'||node.nodeName==='P') && node.innerHTML.trim()==='<br>') return;
        // <div> ou <p> → paragraphe séparé
        if(node.nodeName==='DIV'||node.nodeName==='P'){
          // Cas spécial : div avec un seul noeud texte géant (texte tapé dans Encre)
          if(node.childNodes.length===1 && node.childNodes[0].nodeType===3){
            const txt = node.childNodes[0].textContent;
            // Si le texte contient des \n, c'est plusieurs paragraphes fusionnés
            const lines = txt.split('\n').filter(l=>l.trim());
            if(lines.length > 1){
              lines.forEach(line=>{
                const pPr='<w:ind w:firstLine="720"/><w:spacing w:after="200"/>';
                paras.push(x('w:p',{},x('w:pPr',{},pPr)+
                  x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>')+
                  x('w:t',{'xml:space':'preserve'},esc2(line.trim())))));
              });
              return;
            }
          }
          const runs=nodeToRuns(node);
          if(!runs.trim()) return;
          const pPr='<w:ind w:firstLine="720"/><w:spacing w:after="200"/>';
          paras.push(x('w:p',{},x('w:pPr',{},pPr)+runs));
          return;
        }
        // Autre élément (span, b, etc.)
        const runs=nodeToRuns(node);
        if(!runs.trim()) return;
        const pPr=indentFirst?'<w:ind w:firstLine="720"/><w:spacing w:after="200"/>':'<w:spacing w:after="200"/>';
        paras.push(x('w:p',{},x('w:pPr',{},pPr)+runs));
      });
      return paras.length?paras:[x('w:p',{},x('w:pPr',{},'<w:spacing w:after="200"/>'))];
    }

    // ── Bâtir le document.xml ──
    let body='';

    // Page de titre
    const titreRun=x('w:r',{},
      x('w:rPr',{},'<w:b/><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="56"/>') +
      x('w:t',{},esc2(P.titre||''))
    );
    body+=x('w:p',{},x('w:pPr',{},'<w:jc w:val="center"/><w:spacing w:after="240" w:before="2400"/>') + titreRun);

    if(P.sousTitre){
      body+=x('w:p',{},
        x('w:pPr',{},'<w:jc w:val="center"/><w:spacing w:after="960"/>') +
        x('w:r',{},x('w:rPr',{},'<w:i/><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="28"/><w:color w:val="6b5a4e"/>') + x('w:t',{},esc2(P.sousTitre)))
      );
    } else {
      body+=x('w:p',{},x('w:pPr',{},'<w:spacing w:after="960"/>'));
    }
    if(P.auteur){
      body+=x('w:p',{},
        x('w:pPr',{},'<w:jc w:val="center"/><w:spacing w:after="120"/>') +
        x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>') + x('w:t',{},esc2(P.auteur)))
      );
    }
    const meta=[P.genre,P.annee].filter(Boolean).join(' · ');
    if(meta){
      body+=x('w:p',{},
        x('w:pPr',{},'<w:jc w:val="center"/>') +
        x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="18"/><w:color w:val="9c8878"/>') + x('w:t',{},esc2(meta)))
      );
    }

    // Chapitres
    P.chapitres.forEach((ch,ci)=>{
      const niv = ch.niveau || 2;
      const headingStyle = niv === 1 ? 'Heading1' : 'Heading2';
      body+=x('w:p',{},
        x('w:pPr',{},
          `<w:pStyle w:val="${headingStyle}"/>` +
          '<w:pageBreakBefore/>' +
          '<w:spacing w:before="0" w:after="480"/>'
        ) +
        x('w:r',{},x('w:t',{},esc2(ch.titre)))
      );
      // Contenu (Titre 1 = section sans contenu propre)
      if(ch.contenu){
        const paras=htmlToParagraphs(ch.contenu, true);
        body+=paras.join('');
      }
    });

    const docXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>
${body}
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
</w:sectPr>
</w:body>
</w:document>`;

    // ── Assembler le ZIP ──
    const zip=new JSZip();
    zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
    zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    zip.file('word/document.xml', docXml);
    zip.file('word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
    zip.file('word/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:outlineLvl w:val="0"/>
      <w:jc w:val="center"/>
      <w:spacing w:before="2400" w:after="480"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/>
      <w:b/>
      <w:sz w:val="56"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:outlineLvl w:val="1"/>
      <w:pageBreakBefore/>
      <w:spacing w:before="0" w:after="480"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/>
      <w:b/>
      <w:sz w:val="32"/>
      <w:color w:val="3C2810"/>
    </w:rPr>
  </w:style>
</w:styles>`);

    const blob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    dl(blob,(P.titre||'roman').replace(/\s+/g,'_')+'.docx');
    flash('Export .docx terminé ✓');
  } catch(err){
    alert('Erreur export : '+err.message);
  } finally {
    btn.textContent='→ .docx'; btn.disabled=false;
  }
}

// ── Utilitaires ───────────────────────────────────────────
