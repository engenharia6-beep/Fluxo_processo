// ============================================================
// CONFIGURAÇÃO
// ============================================================
const API = 'https://script.google.com/macros/s/AKfycbwrZjdIKTpNdneierfTXhDosahkXsnIN8oNun-cPV8adVekAAQddRR3LMpeH1Q1je5zGQ/exec';

const SETORES_APP = [
  { nome: 'PCP',          pcp: true               },
  { nome: 'PRODUÇÃO',     seqVe: 1, seqGrava: 2  },
  { nome: 'QUALIDADE',    seqVe: 2, seqGrava: 3  },
  { nome: 'CONSOLIDAÇÃO', seqVe: 3, seqGrava: 4, destinoLivre: true, destinos: ['EXPEDIDO', 'P.A'] },
  { nome: 'EXPEDIDO',     seqVe: 4, seqGrava: 5  },
  { nome: 'P.A',          seqVe: 5, seqGrava: 6  },
];

// Processos e seus insumos (tipo da aba Insumos)
// null = sem insumo, OP obrigatória
// string = tipo do insumo, OP opcional
const PROCESSOS_CONFIG = {
  'Produção':    { insumo: null,        opObrigatoria: true  },
  'Silk':        { insumo: null,        opObrigatoria: true  },
  'Embalagem':   { insumo: null,        opObrigatoria: true  },
  'Desmontagem': { insumo: null,        opObrigatoria: true  },
  'Retrabalho':  { insumo: null,        opObrigatoria: true  },
  'Foco':        { insumo: 'SUBOPTICO', opObrigatoria: false },
  'Preforma':    { insumo: 'PREFORMA',  opObrigatoria: false },
};

const PROCESSOS = Object.keys(PROCESSOS_CONFIG);

function getConfigSetor(setor) {
  const nome = String(setor).trim().toUpperCase().replace(/^\d+-/, '');
  return SETORES_APP.find(s => s.nome.toUpperCase() === nome) || null;
}
function isPCP()      { return !!(getConfigSetor(estado.operador?.setor)?.pcp); }
function ehProducao() { return String(estado.operador?.setor || '').toUpperCase().includes('PRODU'); }

// ============================================================
// ESTADO
// ============================================================
let estado = {
  operador:      null,
  ops:           [],
  opsFiltradas:  [],
  opSelecionada: null,
  setorDestino:  null,
  pd: {
    processo:      null,
    opSelecionada: null,
    ops:           [],
    insumos:       [],       // lista de insumos do processo atual
    insumoSelecionado: null, // { codigo, descricao }
  }
};

// ============================================================
// UTILS
// ============================================================
function $(id) { return document.getElementById(id); }

function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  $(id).classList.add('ativa');
}

function loading(show, txt = 'PROCESSANDO...') {
  $('loading').classList.toggle('ativo', show);
  $('loading-txt').textContent = txt;
}

function toast(msg, tipo = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${tipo} visivel`;
  setTimeout(() => el.classList.remove('visivel'), 3000);
}

async function api(params, body = null) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${API}${qs ? '?' + qs : ''}`;
  const opt = body ? { method: 'POST', body: JSON.stringify(body) } : { method: 'GET' };
  const r   = await fetch(url, opt);
  return r.json();
}

// ============================================================
// LOGIN
// ============================================================
function atualizarBtnLogin() {
  const nome = $('campo-nome').value.trim();
  const pin  = $('campo-pin').value.trim();
  $('btn-login').disabled = !(nome.length >= 2 && pin.length >= 4);
}

async function fazerLogin() {
  const nome = $('campo-nome').value.trim();
  const pin  = $('campo-pin').value.trim();
  if (!nome || !pin) return;
  loading(true, 'AUTENTICANDO...');
  $('login-erro').style.display = 'none';
  try {
    const data = await api({}, { acao: 'login', nome, pin });
    if (data.status === 'ok') {
      estado.operador = data.operador;
      ehProducao() ? mostrarTelaModulos() : entrarNaPrincipal();
    } else {
      $('login-erro').textContent = data.mensagem || 'Usuário ou PIN inválido';
      $('login-erro').style.display = 'block';
      $('campo-pin').value = '';
    }
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

// ============================================================
// MÓDULOS
// ============================================================
function mostrarTelaModulos() {
  $('mod-nome').textContent  = estado.operador.nome;
  $('mod-setor').textContent = estado.operador.setor;
  mostrarTela('tela-modulos');
}

// ============================================================
// FLUXO PRODUTIVO
// ============================================================
function entrarNaPrincipal() {
  $('hd-nome').textContent  = estado.operador.nome;
  $('hd-setor').textContent = estado.operador.setor;
  $('btn-voltar-modulos').style.display = ehProducao() ? 'block' : 'none';
  mostrarTela('tela-principal');
  carregarOPs();
}

async function carregarOPs() {
  loading(true, 'BUSCANDO OPs...');
  try {
    const data = await api({ acao: 'getOPsDisponiveis', setor: estado.operador.setor });
    if (data.status === 'ok') { estado.ops = data.ops || []; aplicarFiltro(); }
    else toast('Erro ao carregar OPs', 'erro');
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

function aplicarFiltro() {
  const filtro = $('filtro-pedido').value.trim().toLowerCase();
  estado.opsFiltradas = filtro
    ? estado.ops.filter(op => String(op.pedido).toLowerCase().includes(filtro) || String(op.op).toLowerCase().includes(filtro))
    : [...estado.ops];
  estado.opSelecionada = null;
  atualizarBotoes();
  renderizarLista();
}

function renderizarLista() {
  const lista = $('ops-lista');
  $('contador-ops').textContent = estado.opsFiltradas.length;
  if (!estado.opsFiltradas.length) {
    lista.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✓</div><div class="empty-state-txt">NENHUMA OP DISPONÍVEL</div></div>`;
    return;
  }
  lista.innerHTML = estado.opsFiltradas.map(op => `
    <div class="op-card" data-op="${op.op}">
      <div class="op-header">
        <div class="op-numero">${op.op}</div>
        <div class="op-pedido">PED ${op.pedido || '—'}</div>
      </div>
      <div class="op-body">
        ${op.foto ? `<img class="op-foto" src="${op.foto}" alt="${op.codigo}" onerror="this.style.display='none'">` : ''}
        <div class="op-info">
          <div class="op-codigo">${op.codigo}</div>
          <div class="op-desc">${op.descricao || '—'}</div>
        </div>
      </div>
      <div class="op-footer">
        <div class="op-qtde">${op.qtde} <span>UN</span></div>
        <div class="op-setor-atual">${op.statusAtual}</div>
      </div>
    </div>`).join('');
  lista.querySelectorAll('.op-card').forEach(card => {
    card.addEventListener('click', () => selecionarOP(card.dataset.op));
  });
}

function selecionarOP(opNum) {
  estado.opSelecionada = estado.opsFiltradas.find(o => String(o.op) === String(opNum)) || null;
  document.querySelectorAll('#ops-lista .op-card').forEach(c => {
    c.classList.toggle('selecionado', c.dataset.op === String(opNum));
  });
  atualizarBotoes();
}

function atualizarBotoes() {
  const tem = !!estado.opSelecionada;
  $('btn-receber').disabled  = !tem;
  const cfg = getConfigSetor(estado.operador.setor);
  $('btn-rejeitar').disabled = !(tem && (isPCP() || (cfg && cfg.seqGrava > 2)));
}

// ============================================================
// MODAL RECEBER
// ============================================================
function abrirModalReceber() {
  const op = estado.opSelecionada;
  if (!op) return;
  $('mr-op').textContent      = op.op;
  $('mr-codigo').textContent  = op.codigo;
  $('mr-qtde').textContent    = op.qtde;
  $('mr-pedido').textContent  = op.pedido || '—';
  $('mr-cliente').textContent = op.cliente || '—';
  $('mr-obs').value           = '';
  estado.destinoReceber       = null;
  const cfg     = getConfigSetor(estado.operador.setor);
  const destDiv = $('mr-destinos');
  if (cfg && cfg.destinoLivre && cfg.destinos) {
    destDiv.style.display = 'block';
    destDiv.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--text2);letter-spacing:1px;margin-bottom:8px">ENVIAR PARA:</div>';
    cfg.destinos.forEach(d => {
      const btn = document.createElement('button');
      btn.className   = 'rejeitar-op-btn';
      btn.textContent = d;
      btn.addEventListener('click', () => {
        estado.destinoReceber = d;
        destDiv.querySelectorAll('.rejeitar-op-btn').forEach(b => b.classList.remove('selecionado'));
        btn.classList.add('selecionado');
      });
      destDiv.appendChild(btn);
    });
  } else {
    destDiv.style.display = 'none';
    destDiv.innerHTML = '';
    estado.destinoReceber = cfg ? cfg.destinos?.[0] || '' : '';
  }
  $('modal-receber').classList.add('ativo');
}

function fecharModalReceber() { $('modal-receber').classList.remove('ativo'); }

async function confirmarReceber() {
  const op  = estado.opSelecionada;
  const cfg = getConfigSetor(estado.operador.setor);
  if (!op) return;
  if (cfg && cfg.destinoLivre && !estado.destinoReceber) { toast('Selecione o destino', 'erro'); return; }
  loading(true, 'GRAVANDO...');
  fecharModalReceber();
  try {
    const data = await api({}, {
      acao: 'receberOP', op: op.op, codigo: op.codigo, qtde: op.qtde,
      pedido: op.pedido, setor: estado.operador.setor, operador: estado.operador.nome,
      destino: estado.destinoReceber || '', origem: op.statusAtual || '',
      obs: $('mr-obs').value.trim()
    });
    if (data.status === 'ok') { toast(data.mensagem, 'sucesso'); estado.opSelecionada = null; await carregarOPs(); }
    else toast(data.erro || 'Erro ao gravar', 'erro');
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

// ============================================================
// MODAL REJEITAR
// ============================================================
function abrirModalRejeitar() {
  const op = estado.opSelecionada;
  if (!op) return;
  $('mj-op').textContent = op.op;
  $('mj-obs').value      = '';
  estado.setorDestino    = null;
  const cfgAtual  = getConfigSetor(estado.operador.setor);
  const destinos  = isPCP()
    ? SETORES_APP.filter(s => !s.pcp)
    : (cfgAtual ? SETORES_APP.filter(s => !s.pcp && s.seqGrava < cfgAtual.seqGrava) : []);
  const container = $('mj-destinos');
  container.innerHTML = '';
  destinos.forEach(s => {
    const btn = document.createElement('button');
    btn.className   = 'rejeitar-op-btn';
    btn.textContent = s.nome;
    btn.addEventListener('click', () => {
      estado.setorDestino = s.nome;
      container.querySelectorAll('.rejeitar-op-btn').forEach(b => b.classList.remove('selecionado'));
      btn.classList.add('selecionado');
    });
    container.appendChild(btn);
  });
  $('modal-rejeitar').classList.add('ativo');
}

function fecharModalRejeitar() { $('modal-rejeitar').classList.remove('ativo'); }

async function confirmarRejeitar() {
  const op = estado.opSelecionada;
  if (!op || !estado.setorDestino) { toast('Selecione o destino da rejeição', 'erro'); return; }
  loading(true, 'GRAVANDO...');
  fecharModalRejeitar();
  try {
    const data = await api({}, {
      acao: 'rejeitarOP', op: op.op, codigo: op.codigo, qtde: op.qtde,
      pedido: op.pedido, setor: estado.operador.setor, setorDestino: estado.setorDestino,
      operador: estado.operador.nome, obs: $('mj-obs').value.trim()
    });
    if (data.status === 'ok') { toast(data.mensagem, 'sucesso'); estado.opSelecionada = null; await carregarOPs(); }
    else toast(data.erro || 'Erro ao gravar', 'erro');
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

// ============================================================
// PRODUÇÃO DIÁRIA — PASSO 1: PROCESSO
// ============================================================
function entrarProducaoDiaria() {
  estado.pd = { processo: null, opSelecionada: null, ops: [], insumos: [], insumoSelecionado: null };
  $('pd-hd-nome').textContent  = estado.operador.nome;
  $('pd-hd-setor').textContent = estado.operador.setor;
  $('btn-pd-proximo').disabled = true;
  renderizarProcessos();
  mostrarTela('tela-pd');
  mostrarPasso('passo-processo');
}

function renderizarProcessos() {
  const grid = $('pd-processos');
  grid.innerHTML = '';
  PROCESSOS.forEach(p => {
    const cfg = PROCESSOS_CONFIG[p];
    const btn = document.createElement('button');
    btn.className   = 'pd-processo-btn';
    // Mostra ícone de insumo se o processo tiver
    btn.innerHTML   = cfg.insumo
      ? `${p}<span class="pd-insumo-tag">${cfg.insumo}</span>`
      : p;
    btn.addEventListener('click', () => {
      estado.pd.processo = p;
      grid.querySelectorAll('.pd-processo-btn').forEach(b => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      $('btn-pd-proximo').disabled = false;
    });
    grid.appendChild(btn);
  });
}

function mostrarPasso(id) {
  document.querySelectorAll('.pd-passo').forEach(p => p.classList.remove('ativo'));
  $(id).classList.add('ativo');
}

async function pdProximo() {
  if (!estado.pd.processo) return;
  $('pd-processo-label').textContent = estado.pd.processo;
  $('btn-pd-lancar').disabled = true;
  estado.pd.opSelecionada    = null;
  estado.pd.insumoSelecionado= null;

  // Carrega OPs e insumos em paralelo
  loading(true, 'CARREGANDO...');
  try {
    const cfg       = PROCESSOS_CONFIG[estado.pd.processo];
    const promises  = [ api({ acao: 'getOPsProducao' }) ];
    if (cfg.insumo) promises.push(api({ acao: 'getInsumos', tipo: cfg.insumo }));
    const results = await Promise.all(promises);
    estado.pd.ops     = results[0].status === 'ok' ? results[0].ops     : [];
    estado.pd.insumos = results[1]?.status === 'ok' ? results[1].insumos : [];
    renderizarOPsProducao();
    mostrarPasso('passo-op');
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

// ============================================================
// PRODUÇÃO DIÁRIA — PASSO 2: OP
// ============================================================
function renderizarOPsProducao() {
  const lista = $('pd-ops-lista');
  if (!estado.pd.ops.length) {
    lista.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-txt">NENHUMA OP ATIVA</div></div>`;
    return;
  }
  lista.innerHTML = estado.pd.ops.map(op => {
    const sp    = op.statusProducao;
    const badge = sp === 'Iniciado'  ? '<span class="pd-badge azul">● EM ANDAMENTO</span>'
                : sp === 'Concluído' ? '<span class="pd-badge verde">● CONCLUÍDO</span>'
                : '<span class="pd-badge cinza">○ NÃO INICIADO</span>';
    return `
      <div class="pd-op-card" data-op="${op.op}">
        <div class="op-header"><div class="op-numero">${op.op}</div>${badge}</div>
        <div class="op-body">
          ${op.foto ? `<img class="op-foto" src="${op.foto}" alt="${op.codigo}" onerror="this.style.display='none'">` : ''}
          <div class="op-info">
            <div class="op-codigo">${op.codigo}</div>
            <div class="op-desc">${op.descricao || '—'}</div>
          </div>
        </div>
        <div class="op-footer">
          <div class="op-qtde">${op.qtde} <span>UN</span></div>
          <div class="op-setor-atual">PED ${op.pedido || '—'}</div>
        </div>
      </div>`;
  }).join('');
  lista.querySelectorAll('.pd-op-card').forEach(card => {
    card.addEventListener('click', () => selecionarOPProducao(card.dataset.op));
  });
}

function selecionarOPProducao(opNum) {
  const op = estado.pd.ops.find(o => String(o.op) === String(opNum));
  estado.pd.opSelecionada = op || null;
  document.querySelectorAll('#pd-ops-lista .pd-op-card').forEach(c => {
    c.classList.toggle('selecionado', c.dataset.op === String(opNum));
  });
  $('btn-pd-lancar').disabled = false;
}

function pdVoltar() {
  estado.pd.processo       = null;
  estado.pd.opSelecionada  = null;
  estado.pd.insumos        = [];
  $('btn-pd-proximo').disabled = true;
  mostrarPasso('passo-processo');
  $('pd-processos').querySelectorAll('.pd-processo-btn').forEach(b => b.classList.remove('ativo'));
}

function pdSemOP() {
  const cfg = PROCESSOS_CONFIG[estado.pd.processo];
  if (cfg.opObrigatoria) { toast('Este processo exige uma OP', 'erro'); return; }
  estado.pd.opSelecionada = null;
  document.querySelectorAll('#pd-ops-lista .pd-op-card').forEach(c => c.classList.remove('selecionado'));
  abrirModalLancamento();
}

function pdLancarComOP() {
  if (!estado.pd.opSelecionada) { toast('Selecione uma OP', 'erro'); return; }
  abrirModalLancamento();
}

// ============================================================
// PRODUÇÃO DIÁRIA — MODAL LANÇAMENTO
// ============================================================
function abrirModalLancamento() {
  const op   = estado.pd.opSelecionada;
  const proc = estado.pd.processo;
  const cfg  = PROCESSOS_CONFIG[proc];

  $('ml-processo').textContent = proc;
  $('ml-op').textContent       = op ? `${op.op} — ${op.codigo}` : '— (sem OP)';
  $('ml-qtde').value           = '';
  $('ml-status-selecionado').value = '';
  $('ml-qtde-grupo').style.display = 'none';
  document.querySelectorAll('.ml-status-btn').forEach(b => b.classList.remove('ativo'));

  // Iniciado só com OP
  $('btn-ml-iniciado').style.display = op ? 'flex' : 'none';

  // Seção insumos
  const insumoSection = $('ml-insumo-section');
  if (cfg.insumo && estado.pd.insumos.length) {
    insumoSection.style.display = 'block';
    $('ml-insumo-tipo').textContent = cfg.insumo;
    renderizarInsumos();
  } else {
    insumoSection.style.display = 'none';
  }

  estado.pd.insumoSelecionado = null;
  $('ml-qtde-insumo').value   = '';

  $('modal-lancamento').classList.add('ativo');
}

function renderizarInsumos() {
  const lista = $('ml-insumos-lista');
  lista.innerHTML = '';
  estado.pd.insumos.forEach(ins => {
    const item = document.createElement('div');
    item.className      = 'ml-insumo-item';
    item.dataset.codigo = ins.codigo;
    item.innerHTML      = `
      <div class="ml-insumo-codigo">${ins.codigo}</div>
      <div class="ml-insumo-desc">${ins.descricao}</div>
      ${ins.estoque !== undefined && ins.estoque !== '' ? `<div class="ml-insumo-estoque">Estoque: ${ins.estoque}</div>` : ''}`;
    item.addEventListener('click', () => {
      estado.pd.insumoSelecionado = ins;
      lista.querySelectorAll('.ml-insumo-item').forEach(i => i.classList.remove('selecionado'));
      item.classList.add('selecionado');
    });
    lista.appendChild(item);
  });
}

function fecharModalLancamento() { $('modal-lancamento').classList.remove('ativo'); }

function selecionarStatusML(status, btn) {
  document.querySelectorAll('.ml-status-btn').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');
  $('ml-status-selecionado').value = status;
  // Qtde produzida + insumo só no Finalizado
  const isFinalizado = status === 'Finalizado';
  $('ml-qtde-grupo').style.display = isFinalizado ? 'block' : 'none';
  const insumoSection = $('ml-insumo-section');
  if (insumoSection.style.display !== 'none') {
    $('ml-insumo-qtde-grupo').style.display = isFinalizado ? 'block' : 'none';
  }
}

async function confirmarLancamento() {
  const status  = $('ml-status-selecionado').value;
  const proc    = estado.pd.processo;
  const cfg     = PROCESSOS_CONFIG[proc];
  const op      = estado.pd.opSelecionada;

  if (!status) { toast('Selecione o status', 'erro'); return; }

  let qtde = 0;
  let qtdeInsumo = '';
  let codigoInsumo = '';

  if (status === 'Finalizado') {
    qtde = Number($('ml-qtde').value);
    if (!qtde || qtde <= 0) { toast('Informe a quantidade produzida', 'erro'); return; }

    // Valida insumo se o processo exige
    if (cfg.insumo) {
      if (!estado.pd.insumoSelecionado) { toast('Selecione o ' + cfg.insumo, 'erro'); return; }
      qtdeInsumo = Number($('ml-qtde-insumo').value);
      if (!qtdeInsumo || qtdeInsumo <= 0) { toast('Informe a quantidade do insumo', 'erro'); return; }
      codigoInsumo = estado.pd.insumoSelecionado.codigo;
    }
  }

  loading(true, 'GRAVANDO...');
  fecharModalLancamento();

  try {
    const data = await api({}, {
      acao:          'registrarProducao',
      op:            op ? op.op : '',
      codigoProduto: op ? op.codigo : '',
      processo:      proc,
      qtde,
      status,
      operador:      estado.operador.nome,
      insumo:        codigoInsumo,
      qtdeInsumo:    qtdeInsumo || ''
    });

    if (data.status === 'ok') {
      toast(data.mensagem, 'sucesso');
      // Atualiza badge na lista
      if (op && (status === 'Iniciado' || status === 'Concluído')) {
        const idx = estado.pd.ops.findIndex(o => o.op === op.op);
        if (idx >= 0) estado.pd.ops[idx].statusProducao = status;
        renderizarOPsProducao();
        document.querySelectorAll('#pd-ops-lista .pd-op-card').forEach(c => {
          if (c.dataset.op === op.op) c.classList.add('selecionado');
        });
        $('btn-pd-lancar').disabled  = false;
        estado.pd.opSelecionada = op;
      }
    } else {
      toast(data.erro || 'Erro ao gravar', 'erro');
    }
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

// ============================================================
// LOGOUT
// ============================================================
function fazerLogout() {
  estado = {
    operador: null, ops: [], opsFiltradas: [], opSelecionada: null, setorDestino: null,
    pd: { processo: null, opSelecionada: null, ops: [], insumos: [], insumoSelecionado: null }
  };
  $('campo-nome').value = '';
  $('campo-pin').value  = '';
  $('btn-login').disabled = true;
  mostrarTela('tela-login');
}

// ============================================================
// EVENTOS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  $('campo-nome').addEventListener('input', atualizarBtnLogin);
  $('campo-pin').addEventListener('input', atualizarBtnLogin);
  $('campo-nome').addEventListener('keydown', e => { if (e.key === 'Enter') $('campo-pin').focus(); });
  $('campo-pin').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });
  $('btn-login').addEventListener('click', fazerLogin);

  document.querySelectorAll('.btn-sair-global').forEach(btn => btn.addEventListener('click', fazerLogout));

  $('btn-modulo-fluxo').addEventListener('click', entrarNaPrincipal);
  $('btn-modulo-pd').addEventListener('click', entrarProducaoDiaria);

  $('btn-atualizar').addEventListener('click', carregarOPs);
  $('filtro-pedido').addEventListener('input', aplicarFiltro);
  $('btn-limpar-filtro').addEventListener('click', () => { $('filtro-pedido').value = ''; aplicarFiltro(); });
  $('btn-receber').addEventListener('click', abrirModalReceber);
  $('btn-rejeitar').addEventListener('click', abrirModalRejeitar);
  $('btn-voltar-modulos').addEventListener('click', mostrarTelaModulos);

  $('mr-cancelar').addEventListener('click', fecharModalReceber);
  $('mr-confirmar').addEventListener('click', confirmarReceber);
  $('modal-receber').addEventListener('click', e => { if (e.target === $('modal-receber')) fecharModalReceber(); });

  $('mj-cancelar').addEventListener('click', fecharModalRejeitar);
  $('mj-confirmar').addEventListener('click', confirmarRejeitar);
  $('modal-rejeitar').addEventListener('click', e => { if (e.target === $('modal-rejeitar')) fecharModalRejeitar(); });

  $('btn-pd-proximo').addEventListener('click', pdProximo);
  $('btn-pd-voltar').addEventListener('click', pdVoltar);
  $('btn-pd-sem-op').addEventListener('click', pdSemOP);
  $('btn-pd-lancar').addEventListener('click', pdLancarComOP);
  $('btn-pd-voltar-modulos').addEventListener('click', mostrarTelaModulos);

  $('btn-ml-iniciado').addEventListener('click',  function(){ selecionarStatusML('Iniciado',  this); });
  $('btn-ml-finalizado').addEventListener('click', function(){ selecionarStatusML('Finalizado', this); });
  $('btn-ml-concluido').addEventListener('click',  function(){ selecionarStatusML('Concluído',  this); });
  $('ml-cancelar').addEventListener('click', fecharModalLancamento);
  $('ml-confirmar').addEventListener('click', confirmarLancamento);
  $('modal-lancamento').addEventListener('click', e => { if (e.target === $('modal-lancamento')) fecharModalLancamento(); });
});
