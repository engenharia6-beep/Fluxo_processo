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

// Configuração de cada processo
// tipo: 'op'     → lista OPs, modal Iniciado/Finalizado/Concluído
// tipo: 'insumo' → vai direto p/ tela de insumo, sem OP, grava como Finalizado
const PROCESSOS_CONFIG = {
  'Produção':    { tipo: 'op',     insumoTipo: null        },
  'Silk':        { tipo: 'op',     insumoTipo: null        },
  'Embalagem':   { tipo: 'op',     insumoTipo: null        },
  'Desmontagem': { tipo: 'op',     insumoTipo: null        },
  'Retrabalho':  { tipo: 'op',     insumoTipo: null        },
  'Foco':        { tipo: 'insumo', insumoTipo: 'SUBOPTICO' },
  'Preforma':    { tipo: 'insumo', insumoTipo: 'PREFORMA'  },
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
    processo:          null,
    opSelecionada:     null,
    ops:               [],
    insumos:           [],
    insumoSelecionado: null,
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
      btn.className = 'rejeitar-op-btn';
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
    btn.className = 'rejeitar-op-btn';
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
    btn.className = 'pd-processo-btn';
    btn.innerHTML = cfg.tipo === 'insumo'
      ? `${p}<span class="pd-insumo-tag">${cfg.insumoTipo}</span>`
      : p;
    btn.addEventListener('click', () => {
      estado.pd.processo = p;
      grid.querySelectorAll('.pd-processo-btn').forEach(b => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      pdProximo();
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
  const cfg = PROCESSOS_CONFIG[estado.pd.processo];
  if (cfg.tipo === 'insumo') { await entrarTelaInsumo(); return; }
  loading(true, 'BUSCANDO OPs...');
  try {
    const data = await api({ acao: 'getOPsProducao' });
    estado.pd.ops          = data.status === 'ok' ? data.ops : [];
    estado.pd.opsFiltradas = [...estado.pd.ops];
    $('pd-processo-label').textContent = estado.pd.processo;
    $('pd-filtro-op').value = '';
    $('pd-contador-ops').textContent = estado.pd.ops.length + ' OP' + (estado.pd.ops.length !== 1 ? 's' : '');
    renderizarOPsProducao();
    mostrarPasso('passo-op');
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

// ============================================================
// PRODUÇÃO DIÁRIA — PASSO 2: OP (processos com OP)
// ============================================================
function filtrarOPsProducao() {
  const filtro = $('pd-filtro-op').value.trim().toLowerCase();
  estado.pd.opsFiltradas = filtro
    ? estado.pd.ops.filter(op =>
        String(op.op).toLowerCase().includes(filtro) ||
        String(op.pedido).toLowerCase().includes(filtro) ||
        String(op.codigo).toLowerCase().includes(filtro))
    : [...estado.pd.ops];
  $('pd-contador-ops').textContent = estado.pd.opsFiltradas.length + ' OP' + (estado.pd.opsFiltradas.length !== 1 ? 's' : '');
  renderizarOPsProducao();
}

function renderizarOPsProducao() {
  const lista = $('pd-ops-lista');
  const ops   = estado.pd.opsFiltradas || estado.pd.ops;
  if (!ops.length) {
    lista.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-txt">NENHUMA OP ENCONTRADA</div></div>`;
    return;
  }
  lista.innerHTML = ops.map(op => {
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
  // Clicar já abre o modal diretamente
  lista.querySelectorAll('.pd-op-card').forEach(card => {
    card.addEventListener('click', () => {
      const op = ops.find(o => String(o.op) === card.dataset.op);
      if (!op) return;
      estado.pd.opSelecionada = op;
      lista.querySelectorAll('.pd-op-card').forEach(c => c.classList.toggle('selecionado', c.dataset.op === card.dataset.op));
      abrirModalLancamento();
    });
  });
}
async function entrarTelaInsumo() {
  const cfg = PROCESSOS_CONFIG[estado.pd.processo];
  loading(true, 'CARREGANDO INSUMOS...');
  try {
    const data = await api({ acao: 'getInsumos', tipo: cfg.insumoTipo });
    estado.pd.insumos = data.status === 'ok' ? data.insumos : [];
    // Monta tela
    $('pi-processo-label').textContent = estado.pd.processo;
    $('pi-tipo-label').textContent     = cfg.insumoTipo;
    $('pi-qtde').value   = '';
    $('pi-obs').value    = '';
    estado.pd.insumoSelecionado = null;
    renderizarInsumosLista();
    mostrarPasso('passo-insumo');
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

function renderizarInsumosLista() {
  const lista = $('pi-insumos-lista');
  lista.innerHTML = '';
  if (!estado.pd.insumos.length) {
    lista.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-txt">NENHUM INSUMO CADASTRADO</div></div>`;
    return;
  }
  estado.pd.insumos.forEach(ins => {
    const item = document.createElement('div');
    item.className      = 'pi-insumo-item';
    item.dataset.codigo = ins.codigo;
    item.innerHTML = `
      ${ins.foto ? `<img class="pi-insumo-foto" src="${ins.foto}" alt="${ins.codigo}" onerror="this.style.display='none'">` : ''}
      <div class="pi-insumo-info">
        <div class="pi-insumo-codigo">${ins.codigo}</div>
        <div class="pi-insumo-desc">${ins.descricao}</div>
        ${ins.estoque !== undefined && ins.estoque !== '' ? `<div class="pi-insumo-estoque">Estoque: ${ins.estoque}</div>` : ''}
      </div>`;
    item.addEventListener('click', () => {
      estado.pd.insumoSelecionado = ins;
      lista.querySelectorAll('.pi-insumo-item').forEach(i => i.classList.remove('selecionado'));
      item.classList.add('selecionado');
      const fotoWrap = $('pi-foto-wrap');
      fotoWrap.innerHTML = ins.foto
        ? `<img src="${ins.foto}" alt="${ins.codigo}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--border)" onerror="this.style.display='none'">`
        : '';
      $('pi-codigo-selecionado').textContent = `${ins.codigo} — ${ins.descricao}`;
      $('pi-codigo-wrap').style.display = 'flex';
    });
    lista.appendChild(item);
  });
}

async function salvarInsumo() {
  if (!estado.pd.insumoSelecionado) { toast('Selecione o insumo', 'erro'); return; }
  const qtde = Number($('pi-qtde').value);
  if (!qtde || qtde <= 0) { toast('Informe a quantidade', 'erro'); return; }
  const obs  = $('pi-obs').value.trim();
  const ins  = estado.pd.insumoSelecionado;
  const proc = estado.pd.processo;

  loading(true, 'GRAVANDO...');
  try {
    const data = await api({}, {
      acao:          'registrarProducao',
      op:            '',
      codigoProduto: ins.codigo,
      processo:      proc,
      qtde,
      status:        'Finalizado',
      operador:      estado.operador.nome,
      insumo:        ins.codigo,
      qtdeInsumo:    qtde,
      obs
    });
    if (data.status === 'ok') {
      toast('Registro salvo!', 'sucesso');
      // Limpa para próximo lançamento
      $('pi-qtde').value = '';
      $('pi-obs').value  = '';
      $('pi-codigo-wrap').style.display = 'none';
      estado.pd.insumoSelecionado = null;
      $('pi-insumos-lista').querySelectorAll('.pi-insumo-item').forEach(i => i.classList.remove('selecionado'));
    } else {
      toast(data.erro || 'Erro ao gravar', 'erro');
    }
  } catch(e) { toast('Erro de conexão', 'erro'); }
  finally    { loading(false); }
}

function pdVoltar() {
  estado.pd.processo       = null;
  estado.pd.opSelecionada  = null;
  estado.pd.insumos        = [];

  mostrarPasso('passo-processo');
  $('pd-processos').querySelectorAll('.pd-processo-btn').forEach(b => b.classList.remove('ativo'));
}

// ============================================================
// PRODUÇÃO DIÁRIA — TELA INSUMO (Foco / Preforma)
// ============================================================

// ============================================================
// MODAL LANÇAMENTO (processos com OP)
// ============================================================
function abrirModalLancamento() {
  const op   = estado.pd.opSelecionada;
  $('ml-processo').textContent     = estado.pd.processo;
  $('ml-op').textContent           = op ? `${op.op} — ${op.codigo}` : '—';
  $('ml-qtde').value               = '';
  $('ml-obs-op').value             = '';
  $('ml-status-selecionado').value = '';
  $('ml-qtde-grupo').style.display = 'none';
  document.querySelectorAll('.ml-status-btn').forEach(b => b.classList.remove('ativo'));
  $('modal-lancamento').classList.add('ativo');
}

function fecharModalLancamento() { $('modal-lancamento').classList.remove('ativo'); }

function selecionarStatusML(status, btn) {
  document.querySelectorAll('.ml-status-btn').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');
  $('ml-status-selecionado').value = status;
  $('ml-qtde-grupo').style.display = status === 'Finalizado' ? 'block' : 'none';
}

async function confirmarLancamento() {
  const status = $('ml-status-selecionado').value;
  const op     = estado.pd.opSelecionada;
  if (!status) { toast('Selecione o status', 'erro'); return; }

  let qtde = 0;
  if (status === 'Finalizado') {
    qtde = Number($('ml-qtde').value);
    if (!qtde || qtde <= 0) { toast('Informe a quantidade produzida', 'erro'); return; }

    // Validação de limite — busca do servidor na hora de salvar (proteção definitiva)
    loading(true, 'VERIFICANDO LIMITE...');
    try {
      const check = await api({ acao: 'getRegistrosProducao', op: op.op, processo: estado.pd.processo });
      const jaLancado = check.status === 'ok'
        ? check.registros.filter(r => r.status === 'Finalizado').reduce((s,r) => s + Number(r.qtde||0), 0)
        : 0;
      const limite    = Number(op.qtde);
      const total     = jaLancado + qtde;

      if (total > limite) {
        loading(false);
        const excesso = total - limite;
        // Alerta mas deixa escolher — conforme pedido ("alertar para o fato")
        const confirmar = confirm(
          `⚠ Atenção!\n\nOP ${op.op} prevê ${limite} UN\nJá lançado: ${jaLancado} UN\nNovo lançamento: ${qtde} UN\nTotal: ${total} UN (excede em ${excesso} UN)\n\nDeseja registrar mesmo assim?`
        );
        if (!confirmar) return;
      }
    } catch(e) { loading(false); /* ignora erro de rede, continua */ }
    finally { loading(false); }
  }

  loading(true, 'GRAVANDO...');
  fecharModalLancamento();
  try {
    const data = await api({}, {
      acao:          'registrarProducao',
      op:            op ? op.op : '',
      codigoProduto: op ? op.codigo : '',
      processo:      estado.pd.processo,
      qtde,
      status,
      operador:      estado.operador.nome,
      obs:           $('ml-obs-op').value.trim(),
      insumo:        '',
      qtdeInsumo:    ''
    });

    if (data.status === 'aviso') {
      // Backend detectou excesso — alerta e pede confirmação
      loading(false);
      const confirmar = confirm(
        `⚠ ATENÇÃO — Limite da OP excedido!\n\nOP prevê: ${data.limiteOP} UN\nJá lançado: ${data.jaLancado} UN\nNovo lançamento: ${data.novaQtde} UN\nTotal ficaria: ${data.total} UN\n\nDeseja gravar mesmo assim?`
      );
      if (!confirmar) return;
      // Grava forçado com flag override
      loading(true, 'GRAVANDO...');
      const data2 = await api({}, {
        acao: 'registrarProducao',
        op: op ? op.op : '', codigoProduto: op ? op.codigo : '',
        processo: estado.pd.processo, qtde, status,
        operador: estado.operador.nome, obs: $('ml-obs-op').value.trim(),
        insumo: '', qtdeInsumo: '', override: true
      });
      if (data2.status === 'ok') {
        toast('Lançamento registrado com excesso de quantidade', 'erro');
      } else {
        toast(data2.erro || 'Erro ao gravar', 'erro');
      }
    } else if (data.status === 'ok') {
      toast(data.mensagem, 'sucesso');
      if (op && (status === 'Iniciado' || status === 'Concluído')) {
        const idx = estado.pd.ops.findIndex(o => o.op === op.op);
        if (idx >= 0) {
          estado.pd.ops[idx].statusProducao = status;
          if (estado.pd.opsFiltradas) {
            const idxF = estado.pd.opsFiltradas.findIndex(o => o.op === op.op);
            if (idxF >= 0) estado.pd.opsFiltradas[idxF].statusProducao = status;
          }
        }
        renderizarOPsProducao();
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

  // Fluxo principal
  $('btn-atualizar').addEventListener('click', carregarOPs);
  $('filtro-pedido').addEventListener('input', aplicarFiltro);
  $('btn-limpar-filtro').addEventListener('click', () => { $('filtro-pedido').value = ''; aplicarFiltro(); });
  $('btn-receber').addEventListener('click', abrirModalReceber);
  $('btn-rejeitar').addEventListener('click', abrirModalRejeitar);
  $('btn-voltar-modulos').addEventListener('click', mostrarTelaModulos);

  // Modal receber/rejeitar
  $('mr-cancelar').addEventListener('click', fecharModalReceber);
  $('mr-confirmar').addEventListener('click', confirmarReceber);
  $('modal-receber').addEventListener('click', e => { if (e.target === $('modal-receber')) fecharModalReceber(); });
  $('mj-cancelar').addEventListener('click', fecharModalRejeitar);
  $('mj-confirmar').addEventListener('click', confirmarRejeitar);
  $('modal-rejeitar').addEventListener('click', e => { if (e.target === $('modal-rejeitar')) fecharModalRejeitar(); });

  // Produção Diária — navegação
  $('btn-pd-voltar').addEventListener('click', pdVoltar);
  $('btn-pd-voltar-insumo').addEventListener('click', pdVoltar);
  $('btn-pd-voltar-modulos').addEventListener('click', mostrarTelaModulos);
  $('pd-filtro-op').addEventListener('input', filtrarOPsProducao);
  $('btn-pd-limpar-filtro').addEventListener('click', () => { $('pd-filtro-op').value = ''; filtrarOPsProducao(); });

  // Tela insumo (Foco/Preforma)
  $('btn-pi-salvar').addEventListener('click', salvarInsumo);

  // Modal lançamento OP
  $('btn-ml-iniciado').addEventListener('click',  function(){ selecionarStatusML('Iniciado',  this); });
  $('btn-ml-finalizado').addEventListener('click', function(){ selecionarStatusML('Finalizado', this); });
  $('btn-ml-concluido').addEventListener('click',  function(){ selecionarStatusML('Concluído',  this); });
  $('ml-cancelar').addEventListener('click', fecharModalLancamento);
  $('ml-confirmar').addEventListener('click', confirmarLancamento);
  $('modal-lancamento').addEventListener('click', e => { if (e.target === $('modal-lancamento')) fecharModalLancamento(); });
});
