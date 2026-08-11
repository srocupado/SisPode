// Teste da CURA de reuniões antigas — reproduz o bug relatado em 11/08/2026:
// reunião consultada na Câmara antes de os campos do Podemos existirem ficava
// sem badge, sem tarja no PDF e com o botão de WhatsApp respondendo "nenhum
// item", porque o Resumir não reconsulta quem já tem idCamara e os campos
// simplesmente não existiam nos itens salvos.
//
// Uso: node testes/lideres-cura.test.js  (usa a API real da Câmara)
const fs=require('fs'),path=require('path');
const pdfjs=require(path.join(__dirname,'..','bot','node_modules','pdfjs-dist','legacy','build','pdf.js'));
const fonte=fs.readFileSync(path.join(__dirname,'..','lideres.js'),'utf8');
const elStub=()=>({style:{},textContent:'',classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],addEventListener(){}});
const sb={document:{addEventListener(){},getElementById:()=>elStub(),querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>elStub(),body:{appendChild(){},removeChild(){}}},
 chrome:{runtime:{getURL:x=>x},storage:{local:{get:(k,cb)=>cb({}),set:(o,cb)=>cb&&cb()}}},
 pdfjsLib:{GlobalWorkerOptions:{},getDocument:pdfjs.getDocument},window:{},fetch:globalThis.fetch,
 btoa:s=>Buffer.from(s,'binary').toString('base64'),console,setTimeout,clearTimeout,DOMException:globalThis.DOMException,XLSX:undefined,
 navigator:{clipboard:{writeText:async t=>{sb._copiado=t;}}}};
const ex=['app','camposNovosFaltando','completarDadosFaltantes','montarMensagemPodemos','itemDoPodemosLideres'];
const L=new Function(...Object.keys(sb),`${fonte}\n; return { ${ex.join(', ')} };`)(...Object.values(sb));
let falhas=0; const ok=(c,m)=>{ if(!c){falhas++;console.log('  ✗ '+m);}else console.log('  ✓ '+m); };
(async()=>{
  // Reunião EXATAMENTE como a salva antes dos campos: tem idCamara, situação,
  // apensação — mas nenhum campo do Podemos.
  const antigo = {ordem:1,numItem:'12',chave:'PL 101/2026',sigla:'PL',numero:101,ano:2026,
    celulaProp:'PL 101/2026 (Principal: PL 23/2026)',autoriaPdf:'Marangoni',regimePdf:'Urgência aprovada em 26/05/2026',
    idCamara:2600030,situacao:'Urgência aprovada (REQ. 1258/2026)',apensacao:'Apensado ao PL 23/2026.',
    relatoria:'Sem indicação',objetivo:'texto da IA preservado',status:'ok'};
  const completoSemPode = {ordem:2,numItem:'20',chave:'PLP 230/2025',sigla:'PLP',numero:230,ano:2025,
    celulaProp:'PLP 230/2025',autoriaPdf:'Juscelino Filho',idCamara:1,autoriaPodemos:false,apensadosPodemos:[],papel:{apensada:false},
    situacao:'x',status:'ok'};
  L.app.reuniao={id:'t',titulo:'T',itens:[antigo,completoSemPode]};

  ok(L.camposNovosFaltando(antigo)===true,'item antigo é detectado como incompleto');
  ok(L.camposNovosFaltando(completoSemPode)===false,'item já completo não é reprocessado');
  ok(L.montarMensagemPodemos()===null,'ANTES da cura: mensagem vazia (o bug relatado)');

  const t0=Date.now();
  await L.completarDadosFaltantes();
  console.log(`  (cura em ${((Date.now()-t0)/1000).toFixed(1)}s)`);

  ok(antigo.autoriaPodemos===true,`depois da cura: autoria Podemos detectada (${antigo.autoriaPodemos})`);
  ok(antigo.objetivo==='texto da IA preservado','texto da IA não foi tocado pela cura');
  const msg=L.montarMensagemPodemos();
  ok(!!msg && /Item 12 - PL 101\/2026 \(Principal: PL 23\/2026\)/.test(msg),'DEPOIS da cura: mensagem traz o item 12');
  ok(/Autoria: Marangoni/.test(msg),'autoria na mensagem');
  console.log('\n'+ (msg||'').split('\n').slice(0,6).join('\n'));
  console.log(falhas?`\n${falhas} FALHA(S)`:'\nCura: tudo passou.');
  process.exit(falhas?1:0);
})().catch(e=>{console.error('FALHOU:',e);process.exit(1)});
