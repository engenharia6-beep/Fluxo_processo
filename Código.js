// ============================================================
// CONFIGURAÇÕES
// ============================================================
const SPREADSHEET_ID = '1ijB_I0_91Hs4_Y9vx5EpiaOrF9GbZ-xbwZ5XeSP5YJg';

// Planilha do Futura-Estoque — usada só pra checar se a OP já foi PAGA
// antes de deixá-la sair do ESTOQUE pra PRODUÇÃO (barreira de início produtivo)
const ESTOQUE_SPREADSHEET_ID = '1YMxrDY8aJk7NvMGd46mOjhJqnhw2bN7-xk-qh1QLCu8';
const ABA_OPS_ESTOQUE        = 'OPS';

// Aba de Qualidade — antes era uma planilha externa separada (mesmo banco
// do AppSheet); migrada pra dentro da planilha principal (SPREADSHEET_ID),
// aba DB_QUALIDADE.
const ABA_QUALIDADE_DADOS = 'DB_QUALIDADE';

const ABAS = {
  fluxo:          'Fluxo_processo',
  operadores:     'Operadores',
  pendencias:     'Pendencias',
  cadastro:       'Cadastro',
  insumos:        'Insumos',
  producaoDiaria: 'Producao_diaria'
};

// Processos com insumo e qual TIPO buscar na aba Insumos
const PROCESSOS_INSUMO = {
  'Foco':    'SUBOPTICO',
  'Preforma':'PREFORMA'
};

const SETORES_APP = [
  { nome: 'PCP',          pcp: true                                                                                                },
  { nome: 'PRODUCAO',     origem: 'ESTOQUE',      destino: 'PRODUCAO',     origemReal: 'ESTOQUE',      destinoReal: 'PRODUÇÃO'    },
  { nome: 'QUALIDADE',    origem: 'PRODUCAO',     destino: 'QUALIDADE',    origemReal: 'PRODUÇÃO',     destinoReal: 'QUALIDADE'   },
  { nome: 'CONSOLIDACAO', origem: 'QUALIDADE',    destino: 'CONSOLIDACAO', origemReal: 'QUALIDADE',    destinoReal: 'CONSOLIDAÇÃO', destinoLivre: true },
  { nome: 'EXPEDIDO',     origem: 'CONSOLIDACAO', destino: 'EXPEDIDO',     origemReal: 'CONSOLIDAÇÃO', destinoReal: 'EXPEDIDO'    },
  { nome: 'PA',           origem: 'CONSOLIDACAO', destino: 'PA',           origemReal: 'CONSOLIDAÇÃO', destinoReal: 'P.A'         },
];

function normalizar(str) {
  return String(str).trim().toUpperCase()
    .replace(/^\d+-/, '')
    .replace(/[ÀÁÂÃÄ]/g, 'A').replace(/[ÈÉÊË]/g, 'E').replace(/[ÌÍÎÏ]/g, 'I')
    .replace(/[ÒÓÔÕÖ]/g, 'O').replace(/[ÙÚÛÜ]/g, 'U')
    .replace(/Ç/g, 'C').replace(/Ã/g, 'A').replace(/Õ/g, 'O')
    .replace(/\./g, '').replace(/-/g, '');
}

function getSetorConfig(setor) {
  const nome = normalizar(setor);
  return SETORES_APP.find(s => s.nome === nome) || null;
}

// Mapa {codigo: foto} lido da aba Cadastro — usado por getOPsDisponiveis,
// getOPsProducao e getOPsAguardandoInspecao.
function _fotosPorCodigo(ss) {
  const abaCad  = ss.getSheetByName(ABAS.cadastro);
  const cadRows = abaCad ? abaCad.getDataRange().getValues() : [];
  const fotos = {};
  for (let i = 1; i < cadRows.length; i++) {
    const cod  = String(cadRows[i][0]).trim();
    const foto = String(cadRows[i][2]).trim();
    if (cod && foto) fotos[cod] = foto;
  }
  return fotos;
}

function responder(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// BARREIRA DE INÍCIO PRODUTIVO — OP só sai do ESTOQUE se PAGA
// Lê direto a aba OPS do Futura-Estoque (mesma conta dona das duas
// planilhas) em vez de duplicar o dado numa aba/chave local.
// ============================================================
function _opsPagasNoEstoque() {
  try {
    const ss  = SpreadsheetApp.openById(ESTOQUE_SPREADSHEET_ID);
    const aba = ss.getSheetByName(ABA_OPS_ESTOQUE);
    if (!aba) return {};
    const rows = aba.getDataRange().getValues();
    if (rows.length < 2) return {};
    const h = rows[0];
    const idx = {};
    h.forEach((v, i) => { idx[String(v || '').trim().toUpperCase()] = i; });
    const iOP   = idx['OP']   ?? -1;
    const iPago = idx['PAGO'] ?? -1;
    if (iOP < 0 || iPago < 0) return {};
    const mapa = {};
    for (let i = 1; i < rows.length; i++) {
      const op = String(rows[i][iOP] || '').trim();
      if (!op) continue;
      mapa[op] = String(rows[i][iPago] || '').trim().toUpperCase() === 'PAGO';
    }
    return mapa;
  } catch (e) {
    // Falha ao ler o Estoque não pode travar o fluxo inteiro — loga e
    // deixa passar (fail-open) pra não parar a produção por um erro de leitura.
    Logger.log('Erro ao ler OPs pagas no Estoque: ' + e.message);
    return null;
  }
}

// ============================================================
// REGISTRAR INSPEÇÃO DE QUALIDADE
// Grava na planilha externa (mesmo banco do AppSheet), aba "dados".
// Colunas: ID | DATA | DIA | QRCODE | CODIGO | OP | QTDE | d_ETIQUETA |
// d_SILK | d_EMBALAGEM | d_ACESSORIOS | d_CASE | d_LENTE | T_Defeitos |
// STATUS | OBS | DESCRIÇÃO | IMG | MÊS_
// Lê o cabeçalho pelo nome da coluna em vez de posição fixa, pra não
// quebrar se a ordem das colunas mudar na planilha.
// ============================================================
function registrarQualidade(body) {
  try {
    const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
    const aba = ss.getSheetByName(ABA_QUALIDADE_DADOS);
    if (!aba) return { status: 'erro', mensagem: 'Aba "' + ABA_QUALIDADE_DADOS + '" nao encontrada na planilha principal.' };

    const header = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
    const idxCol = {};
    header.forEach((v, i) => { idxCol[String(v || '').trim().toUpperCase()] = i; });
    const set = (linha, nome, valor) => {
      const i = idxCol[nome.toUpperCase()];
      if (i != null && i >= 0) linha[i] = valor;
    };

    const defeitos = {
      D_ETIQUETA:   Number(body.etiqueta)    || 0,
      D_SILK:       Number(body.silk)        || 0,
      D_EMBALAGEM:  Number(body.embalagem)   || 0,
      D_ACESSORIOS: Number(body.acessorios)  || 0,
      D_CASE:       Number(body.caseProduto) || 0,
      D_LENTE:      Number(body.lente)       || 0,
    };
    const totalDefeitos = Object.keys(defeitos).reduce((s, k) => s + defeitos[k], 0);
    // Resultado é escolha manual da inspetora (body.status) — o cálculo pela
    // soma de defeitos só entra como fallback se por algum motivo não vier.
    const status = (body.status === 'APROVADO' || body.status === 'REPROVADO')
      ? body.status
      : (totalDefeitos > 0 ? 'REPROVADO' : 'APROVADO');
    const agora  = new Date();

    const linha = new Array(header.length).fill('');
    set(linha, 'ID',       Utilities.getUuid().substring(0, 8));
    set(linha, 'DATA',     Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
    set(linha, 'DIA',      Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy'));
    set(linha, 'QRCODE',   body.op + '@' + body.codigo + '@' + body.qtde + '@OP');
    set(linha, 'CODIGO',   body.codigo || '');
    set(linha, 'OP',       body.op || '');
    set(linha, 'QTDE',     Number(body.qtde) || 0);
    Object.keys(defeitos).forEach(nome => set(linha, nome, defeitos[nome] || ''));
    set(linha, 'T_Defeitos', totalDefeitos);
    set(linha, 'STATUS',     status);
    set(linha, 'OBS',        body.obs || '');
    set(linha, 'DESCRIÇÃO',  body.descricao || '');
    set(linha, 'IMG',        body.foto || '');
    set(linha, 'MÊS_',       Number(Utilities.formatDate(agora, Session.getScriptTimeZone(), 'M')));

    aba.appendRow(linha);
    return { status: 'ok', mensagem: 'Inspecao registrada — OP ' + body.op + ' (' + status + ')', totalDefeitos, statusQualidade: status };
  } catch (e) {
    return { status: 'erro', mensagem: 'Erro ao gravar inspecao: ' + e.message };
  }
}

// ============================================================
// doGet
// ============================================================
function doGet(e) {
  const acao = e.parameter.acao || '';
  try {
    if (acao === 'getOperadores')        return responder(getOperadores());
    if (acao === 'getOPsDisponiveis')    return responder(getOPsDisponiveis(e.parameter.setor));
    if (acao === 'getOPsAguardandoInspecao') return responder(getOPsAguardandoInspecao());
    if (acao === 'getHistoricoOP')       return responder(getHistoricoOP(e.parameter.op));
    if (acao === 'getPendencias')        return responder(getPendencias(e.parameter.pedido));
    if (acao === 'getOPsProducao')       return responder(getOPsProducao());
    if (acao === 'getRegistrosProducao') return responder(getRegistrosProducao(e.parameter.op, e.parameter.processo));
    if (acao === 'getInsumos')           return responder(getInsumos(e.parameter.tipo));
    return responder({ status: 'ok', versao: '3.6' });
  } catch(err) {
    return responder({ erro: err.toString() });
  }
}

// ============================================================
// doPost
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const acao = body.acao || '';
    if (acao === 'login')             return responder(login(body));
    if (acao === 'receberOP')         return responder(receberOP(body));
    if (acao === 'rejeitarOP')        return responder(rejeitarOP(body));
    if (acao === 'registrarProducao') return responder(registrarProducao(body));
    if (acao === 'registrarQualidade')return responder(registrarQualidade(body));
    if (acao === 'avancarQualidade')  return responder(avancarQualidade(body));
    return responder({ erro: 'Acao desconhecida' });
  } catch(err) {
    return responder({ erro: err.toString() });
  }
}

// ============================================================
// LOGIN
// ============================================================
function login(body) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba  = ss.getSheetByName(ABAS.operadores);
  const rows = aba.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const [id, nome, pin, setor, ativo] = rows[i];
    if (normalizar(nome) === normalizar(body.nome) &&
        String(pin).trim() === String(body.pin).trim() &&
        String(ativo).trim().toUpperCase() === 'S') {
      const config = getSetorConfig(setor);
      const ehPCP  = config && config.pcp;
      return {
        status: 'ok',
        operador: {
          id, nome, setor,
          origem:  ehPCP ? '' : (config ? config.origemReal  : ''),
          destino: ehPCP ? '' : (config ? config.destinoReal : '')
        }
      };
    }
  }
  return { status: 'erro', mensagem: 'Usuario ou PIN invalido' };
}

// ============================================================
// GET OPERADORES
// ============================================================
function getOperadores() {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba  = ss.getSheetByName(ABAS.operadores);
  const rows = aba.getDataRange().getValues();
  const lista = [];
  for (let i = 1; i < rows.length; i++) {
    const [id, nome, , setor, ativo] = rows[i];
    if (String(ativo).trim().toUpperCase() === 'S') lista.push({ id, nome, setor });
  }
  return { status: 'ok', operadores: lista };
}

// ============================================================
// GET OPs DISPONÍVEIS (Fluxo Produtivo)
// ============================================================
function getOPsDisponiveis(setorOperador) {
  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const abaPend = ss.getSheetByName(ABAS.pendencias);
  const config  = getSetorConfig(setorOperador);
  if (!config) return { status: 'erro', mensagem: 'Setor "' + setorOperador + '" nao opera no app' };
  const ehPCP   = !!config.pcp;

  // Barreira de início produtivo: só busca OPs pagas quando o setor recebe
  // direto do ESTOQUE (hoje, só PRODUCAO). PCP continua vendo tudo, pra manter
  // visibilidade do fluxo inteiro independente de pagamento.
  const exigePago = !ehPCP && config.origem === 'ESTOQUE';
  const opsPagas  = exigePago ? _opsPagasNoEstoque() : null;

  const pendRows = abaPend.getDataRange().getValues();
  const fotos = _fotosPorCodigo(ss);
  const ops = [];
  for (let i = 1; i < pendRows.length; i++) {
    const op       = pendRows[i][7];
    const statusRaw= pendRows[i][8];
    if (!op) continue;
    const STATUS_PCP = ['PCP','ESTOQUE','PRODUCAO','QUALIDADE','CONSOLIDACAO'];
    if (ehPCP) { if (!STATUS_PCP.includes(normalizar(statusRaw))) continue; }
    else        { if (normalizar(statusRaw) !== config.origem) continue; }

    // opsPagas === null => falha ao ler o Estoque, deixa passar (fail-open)
    if (exigePago && opsPagas && !opsPagas[String(op).trim()]) continue;

    const codigoStr = String(pendRows[i][2]).trim();
    ops.push({
      op: String(op), codigo: codigoStr, descricao: String(pendRows[i][3]),
      qtde: pendRows[i][4], pedido: String(pendRows[i][6]), cliente: String(pendRows[i][1]),
      statusAtual: String(statusRaw),
      origem:  ehPCP ? String(statusRaw) : config.origemReal,
      destino: ehPCP ? '' : config.destinoReal,
      foto: fotos[codigoStr] || ''
    });
  }
  return { status: 'ok', ops: ops };
}

// ============================================================
// GET OPs AGUARDANDO INSPEÇÃO (Qualidade)
// OPs já recebidas pela QUALIDADE (statusAtual == QUALIDADE) mas que ainda
// não foram avançadas para CONSOLIDACAO por uma inspeção aprovada — ver
// avancarQualidade().
// ============================================================
function getOPsAguardandoInspecao() {
  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const abaPend = ss.getSheetByName(ABAS.pendencias);
  const pendRows= abaPend.getDataRange().getValues();
  const fotos   = _fotosPorCodigo(ss);
  const ops = [];
  for (let i = 1; i < pendRows.length; i++) {
    const op        = pendRows[i][7];
    const statusRaw = pendRows[i][8];
    if (!op) continue;
    if (normalizar(statusRaw) !== 'QUALIDADE') continue;
    const codigoStr = String(pendRows[i][2]).trim();
    ops.push({
      op: String(op), codigo: codigoStr, descricao: String(pendRows[i][3]),
      qtde: pendRows[i][4], pedido: String(pendRows[i][6]), cliente: String(pendRows[i][1]),
      statusAtual: String(statusRaw),
      foto: fotos[codigoStr] || ''
    });
  }
  return { status: 'ok', ops: ops };
}

// ============================================================
// GET OPs PRODUÇÃO DIÁRIA
// ============================================================
function getOPsProducao() {
  const ss       = SpreadsheetApp.openById(SPREADSHEET_ID);
  const abaPend  = ss.getSheetByName(ABAS.pendencias);
  const pendRows = abaPend.getDataRange().getValues();

  // Status de produção por OP (Iniciado / Concluído)
  const abaProd = ss.getSheetByName(ABAS.producaoDiaria);
  const statusOP = {};
  if (abaProd) {
    const prodRows = abaProd.getDataRange().getValues();
    for (let i = 1; i < prodRows.length; i++) {
      const op     = String(prodRows[i][0]).trim(); // A: OP
      const status = String(prodRows[i][5]).trim(); // F: Status
      if (op) {
        if (!statusOP[op] || status === 'Concluído') statusOP[op] = status;
      }
    }
  }

  const fotos = _fotosPorCodigo(ss);

  const STATUS_ATIVOS = ['PCP','ESTOQUE','PRODUCAO','QUALIDADE','CONSOLIDACAO'];
  const ops = [];
  for (let i = 1; i < pendRows.length; i++) {
    const op        = pendRows[i][7];
    const statusRaw = pendRows[i][8];
    if (!op) continue;
    if (!STATUS_ATIVOS.includes(normalizar(statusRaw))) continue;
    const codigoStr = String(pendRows[i][2]).trim();
    const opStr     = String(op).trim();
    ops.push({
      op: opStr, codigo: codigoStr, descricao: String(pendRows[i][3]),
      qtde: pendRows[i][4], pedido: String(pendRows[i][6]), cliente: String(pendRows[i][1]),
      statusFluxo:    String(statusRaw),
      statusProducao: statusOP[opStr] || '',
      foto: fotos[codigoStr] || ''
    });
  }
  return { status: 'ok', ops: ops };
}

// ============================================================
// GET INSUMOS — filtra por TIPO na aba Insumos
// Colunas: A=CÓDIGO | B=DESCRIÇÃO | C=TIPO | D=Foto | E=ESTOQUE
// ============================================================
function getInsumos(tipo) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba  = ss.getSheetByName(ABAS.insumos);
  if (!aba) return { status: 'erro', mensagem: 'Aba Insumos nao encontrada' };
  const rows  = aba.getDataRange().getValues();
  const lista = [];
  for (let i = 1; i < rows.length; i++) {
    const codigo = String(rows[i][0]).trim();
    const desc   = String(rows[i][1]).trim();
    const tipo_  = String(rows[i][2]).trim().toUpperCase();
    const foto   = String(rows[i][3]).trim();
    const estoque= rows[i][4];
    if (!codigo) continue;
    if (tipo && tipo_.toUpperCase() !== String(tipo).toUpperCase()) continue;
    lista.push({ codigo, descricao: desc, tipo: tipo_, foto, estoque });
  }
  return { status: 'ok', insumos: lista };
}

// ============================================================
// GET REGISTROS PRODUÇÃO
// ============================================================
function getRegistrosProducao(op, processo) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba = ss.getSheetByName(ABAS.producaoDiaria);
  if (!aba) return { status: 'ok', registros: [] };
  const rows = aba.getDataRange().getValues();
  const hoje     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const hojeISO  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const hojeUS   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy');
  const registros = [];
  for (let i = 1; i < rows.length; i++) {
    const rowOP      = String(rows[i][0]).trim(); // A: OP
    const rowDiaRaw  = rows[i][3];               // D: Dia
    const rowProcesso= String(rows[i][4]).trim(); // E: Processo

    // Normaliza a data — pode vir como string ou objeto Date
    let rowDia = '';
    if (rowDiaRaw instanceof Date) {
      rowDia = Utilities.formatDate(rowDiaRaw, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    } else {
      rowDia = String(rowDiaRaw).trim();
    }

    if (op && rowOP !== String(op).trim()) continue;
    if (processo && rowProcesso !== String(processo).trim()) continue;
    // Aceita qualquer formato de hoje
    const ehHoje = rowDia === hoje || rowDia === hojeISO || rowDia === hojeUS ||
                   rowDia.startsWith(hoje.split('/').reverse().join('-')) ||
                   rowDia.includes(hoje.split('/')[0] + '/' + hoje.split('/')[1]);
    if (!ehHoje) continue;

    registros.push({
      id:            String(rows[i][7]).trim(),  // H
      op:            rowOP,
      codigoProduto: String(rows[i][1]).trim(),  // B
      qtde:          Number(rows[i][2]) || 0,    // C — força número
      dia:           rowDia,
      processo:      rowProcesso,
      status:        String(rows[i][5]).trim(),  // F
      hora:          rows[i][6],                 // G
      insumo:        String(rows[i][9]).trim(),  // J
      qtdeInsumo:    rows[i][10]                 // K
    });
  }
  return { status: 'ok', registros: registros, debug_hoje: hoje };
}

// ============================================================
// REGISTRAR PRODUÇÃO DIÁRIA
// Colunas: A=OP | B=Codigo_Produto | C=Qtde | D=Dia | E=Processo
//          F=Status | G=Hora | H=ID | I=Operador | J=Insumo | K=Qtde_Insumo
// ============================================================
function registrarProducao(body) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   aba = ss.getSheetByName(ABAS.producaoDiaria);

  if (!aba) {
    aba = ss.insertSheet(ABAS.producaoDiaria);
    const cab = ['OP','Codigo_Produto','Qtde','Dia','Processo','Status','Hora','ID','Operador','Insumo','Qtde_Insumo'];
    aba.appendRow(cab);
    aba.getRange(1,1,1,cab.length).setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');
    aba.setFrozenRows(1);
  }

  const agora  = new Date();
  const id     = Utilities.getUuid().substring(0, 8);
  const dia    = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const status = body.status || 'Finalizado';
  const qtde   = status === 'Finalizado' ? (Number(body.qtde) || 0) : 0;

  // Validação de limite no backend (barreira definitiva)
  if (status === 'Finalizado' && qtde > 0 && body.op) {
    const resultado = getRegistrosProducao(body.op, body.processo);
    const jaLancado = resultado.registros
      .filter(r => r.status === 'Finalizado')
      .reduce((s, r) => s + Number(r.qtde || 0), 0);

    // Busca qtde da OP na aba Pendencias
    const abaPend  = ss.getSheetByName(ABAS.pendencias);
    const pendRows = abaPend ? abaPend.getDataRange().getValues() : [];
    let limiteOP   = 0;
    for (let i = 1; i < pendRows.length; i++) {
      if (String(pendRows[i][7]).trim() === String(body.op).trim()) {
        limiteOP = Number(pendRows[i][4]) || 0;
        break;
      }
    }

    if (limiteOP > 0 && jaLancado + qtde > limiteOP && !body.override) {
      return {
        status:  'aviso',
        mensagem: 'Limite da OP excedido: ' + limiteOP + ' UN previstas, ' + jaLancado + ' UN ja lancadas, tentativa de lancar mais ' + qtde + ' UN',
        jaLancado, limiteOP, novaQtde: qtde, total: jaLancado + qtde
      };
    }
  }

  // Colunas: OP | Codigo_Produto | Qtde | Dia | Processo | Status | Hora | ID | Operador | Insumo | Qtde_Insumo
  aba.appendRow([
    body.op            || '',
    body.codigoProduto || '',
    qtde,
    dia,
    body.processo      || '',
    status,
    agora,
    id,
    body.operador      || '',
    body.insumo        || '',
    body.qtdeInsumo    || ''
  ]);

  return {
    status:   'ok',
    mensagem: 'Registro salvo — ' + (body.op || 'sem OP') + ' | ' + body.processo + ' | ' + status,
    id
  };
}

// ============================================================
// SETUP — recriar aba Producao_diaria com cabeçalhos corretos
// Execute UMA VEZ no Apps Script após atualizar o Code.gs
// ============================================================
function setupProducaoDiaria() {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   aba = ss.getSheetByName(ABAS.producaoDiaria);

  // Se já existe, apaga e recria para garantir cabeçalhos corretos
  if (aba) {
    // Preserva dados existentes — só adiciona colunas que faltam
    const cabecalhos = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
    const esperado   = ['OP','Codigo_Produto','Qtde','Dia','Processo','Status','Hora','ID','Operador','Insumo','Qtde_Insumo'];
    // Adiciona colunas novas que não existem
    esperado.forEach((col, idx) => {
      if (!cabecalhos.includes(col)) {
        aba.getRange(1, idx + 1).setValue(col);
      }
    });
    Logger.log('Aba atualizada: ' + ABAS.producaoDiaria);
    return;
  }

  aba = ss.insertSheet(ABAS.producaoDiaria);
  const cab = ['OP','Codigo_Produto','Qtde','Dia','Processo','Status','Hora','ID','Operador','Insumo','Qtde_Insumo'];
  aba.appendRow(cab);
  aba.getRange(1,1,1,cab.length).setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');
  aba.setFrozenRows(1);
  const widths = [100,120,70,100,120,100,160,100,120,150,100];
  widths.forEach((w,i) => aba.setColumnWidth(i+1, w));
  Logger.log('Aba criada: ' + ABAS.producaoDiaria);
}

// ============================================================
// RECEBER OP
// ============================================================
function receberOP(body) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba = ss.getSheetByName(ABAS.fluxo);
  const config = getSetorConfig(body.setor);
  if (!config) return { status: 'erro', mensagem: 'Setor "' + body.setor + '" invalido' };
  const ehPCP        = !!config.pcp;
  const destinoLivre = !!config.destinoLivre;

  // Barreira de início produtivo — definitiva no backend, igual ao padrão já
  // usado no limite de quantidade de registrarProducao. Só vale pra quem
  // recebe direto do ESTOQUE (hoje, setor PRODUCAO); PCP não é bloqueado.
  if (!ehPCP && config.origem === 'ESTOQUE') {
    const opsPagas = _opsPagasNoEstoque();
    if (opsPagas && !opsPagas[String(body.op).trim()]) {
      return { status: 'erro', mensagem: 'OP ' + body.op + ' ainda nao foi paga no Estoque.' };
    }
  }

  const origemGravar  = ehPCP ? (body.origem || 'PCP') : config.origemReal;
  const destinoGravar = (ehPCP || destinoLivre) ? (body.destino || config.destinoReal) : config.destinoReal;
  const agora  = new Date();
  const id     = Utilities.getUuid().substring(0, 8);
  const qrcode = body.op + '@' + body.codigo + '@' + body.qtde + '@OP';
  aba.appendRow([
    id, agora,
    Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    qrcode, body.op, body.codigo, body.qtde,
    origemGravar, body.pedido || '', body.obs || '',
    destinoGravar, '', 'RECEBER', body.operador
  ]);
  return { status: 'ok', mensagem: 'OP ' + body.op + ' recebida em ' + destinoGravar };
}

// ============================================================
// REJEITAR OP
// ============================================================
function rejeitarOP(body) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba = ss.getSheetByName(ABAS.fluxo);
  const configAtual = getSetorConfig(body.setor);
  const configDest  = getSetorConfig(body.setorDestino);
  if (!configAtual) return { status: 'erro', mensagem: 'Setor "' + body.setor + '" invalido' };
  if (!configDest)  return { status: 'erro', mensagem: 'Setor destino "' + body.setorDestino + '" invalido' };
  const agora  = new Date();
  const id     = Utilities.getUuid().substring(0, 8);
  const qrcode = body.op + '@' + body.codigo + '@' + body.qtde + '@OP';
  aba.appendRow([
    id, agora,
    Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    qrcode, body.op, body.codigo, body.qtde,
    configAtual.destinoReal, body.pedido || '', body.obs || '',
    configDest.origemReal, '', 'REJEITAR', body.operador
  ]);
  return { status: 'ok', mensagem: 'OP ' + body.op + ' rejeitada para ' + configDest.origemReal };
}

// ============================================================
// AVANÇAR QUALIDADE — libera a OP para CONSOLIDACAO depois de uma
// inspeção aprovada. Sem isso, a OP fica presa em status QUALIDADE
// (recebida, aguardando inspeção) e não aparece pra Consolidação.
// ============================================================
function avancarQualidade(body) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba = ss.getSheetByName(ABAS.fluxo);
  const configAtual = getSetorConfig(body.setor);
  const configDest  = getSetorConfig('CONSOLIDACAO');
  if (!configAtual) return { status: 'erro', mensagem: 'Setor "' + body.setor + '" invalido' };
  const agora  = new Date();
  const id     = Utilities.getUuid().substring(0, 8);
  const qrcode = body.op + '@' + body.codigo + '@' + body.qtde + '@OP';
  aba.appendRow([
    id, agora,
    Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    qrcode, body.op, body.codigo, body.qtde,
    configAtual.destinoReal, body.pedido || '', body.obs || '',
    configDest.origemReal, '', 'INSPECIONAR', body.operador
  ]);
  return { status: 'ok', mensagem: 'OP ' + body.op + ' aprovada e liberada para ' + configDest.origemReal };
}

// ============================================================
// HISTÓRICO DE UMA OP
// ============================================================
function getHistoricoOP(op) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba  = ss.getSheetByName(ABAS.fluxo);
  const rows = aba.getDataRange().getValues();
  const historico = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[4]).trim() !== String(op).trim()) continue;
    historico.push({ data: row[1], origem: row[7], destino: row[10], qtde: row[6], acao: row[12], operador: row[13], obs: row[9] });
  }
  return { status: 'ok', historico: historico };
}

// ============================================================
// GET PENDENCIAS
// ============================================================
function getPendencias(pedidoFiltro) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const aba  = ss.getSheetByName(ABAS.pendencias);
  const rows = aba.getDataRange().getValues();
  const lista = [];
  for (let i = 1; i < rows.length; i++) {
    const op     = rows[i][7];
    const pedido = rows[i][6];
    if (!op) continue;
    if (pedidoFiltro && String(pedido) !== String(pedidoFiltro)) continue;
    lista.push({ op: String(op), codigo: String(rows[i][2]), descricao: String(rows[i][3]), qtde: rows[i][4], pedido: String(pedido), cliente: String(rows[i][1]), status: String(rows[i][8]) });
  }
  return { status: 'ok', pendencias: lista };
}

// ============================================================
// TESTES
// ============================================================
function testarGetOPs()      { Logger.log(JSON.stringify(getOPsDisponiveis('PRODUCAO'))); }
function testarProducao()    { Logger.log(JSON.stringify(getOPsProducao())); }
function testarInsumos()     { Logger.log(JSON.stringify(getInsumos('SUBOPTICO'))); }
function testarOpsPagasEstoque() { Logger.log(JSON.stringify(_opsPagasNoEstoque())); }
