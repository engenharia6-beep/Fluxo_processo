Aqui está o resumo completo para colar numa nova conversa:

---

# Contexto do Projeto — Fluxo Produtivo

## O que estamos construindo
App web de controle de fluxo produtivo com lógica de **custódia**. Cada setor bipa que recebeu do anterior. Backend em Google Apps Script + Frontend em GitHub Pages.

## Links
- **Planilha:** `https://docs.google.com/spreadsheets/d/1ijB_I0_91Hs4_Y9vx5EpiaOrF9GbZ-xbwZ5XeSP5YJg`
- **API:** `https://script.google.com/macros/s/AKfycbwrZjdIKTpNdneierfTXhDosahkXsnIN8oNun-cPV8adVekAAQddRR3LMpeH1Q1je5zGQ/exec`
- **Frontend:** GitHub Pages (repositório a confirmar)

## Abas da Planilha
- `Operadores` → ID, Nome, PIN, Setor, Ativo
- `Fluxo_Processo` → Log: ID, Data, Operador, Setor, OP, Código, Descrição, Qtde, Ação, Custódia De, Custódia Até, OBS, QRCode
- `Fluxo_Status` → OP, Código, Descrição, Qtde, Custódia, Última Atualização, Último Operador
- `Fluxo_Config` → Ordem, Setor, RecebeDE, PodeRejeitarPara
- `Cadastro` → Código, Descrição

## Fluxo de Custódia
```
PCP lança OP → nasce no ESTOQUE
ESTOQUE bipa → PRODUÇÃO
PRODUÇÃO bipa → QUALIDADE
QUALIDADE bipa → CONSOLIDAÇÃO  (pode rejeitar → PRODUÇÃO)
CONSOLIDAÇÃO bipa → EXPEDIDO   (pode rejeitar → PRODUÇÃO, QUALIDADE)
EXPEDIDO bipa → PA             (pode rejeitar → QUALIDADE)
```
- PCP não bipa recebimento — ele lança a OP e ela nasce direto no ESTOQUE
- 1 bipa = custódia muda para o setor que bipou
- Sem I/F — só custódia atual

## Perfis no App
- **PCP** → tela de lançamento de OP (campos: QR, OP, Código, Qtde, OBS)
- **Demais setores** → lista OPs do setor anterior, botão RECEBER ou REJEITAR
- Login: seleciona nome na lista + digita PIN
- Processo/Setor fixo por operador (vem do cadastro)

## QR Code
- Formato: `OP@Código@Qtde` (ex: `3762@7898641420904@12`)
- Suporta câmera (jsQR) e scanner externo (teclado)

## Endpoints da API (doGet)
- `getOperadores` → lista ativos sem PIN
- `getFluxoConfig` → config do fluxo
- `getOPsDisponiveis?setor=X` → OPs no setor anterior ao X
- `getFluxoStatus` → custódia atual de todas OPs
- `getHistoricoOP?op=X` → histórico de uma OP

## Endpoints da API (doPost)
- `login` → { nome, pin }
- `lancarOP` → PCP lança OP para ESTOQUE
- `receberOP` → setor confirma recebimento
- `rejeitarOP` → setor devolve com motivo

## Arquivos prontos
- `Code.gs` → backend v2.0 implantado e funcionando
- `index.html` → estrutura das telas
- `app.js` → lógica completa
- `app.css` → visual

## Status atual
- ✅ Backend implantado e testado (`{"status":"ok"}` confirmado)
- ✅ Frontend v2.0 pronto (3 arquivos)
- ⏳ Subir frontend no GitHub Pages
- ⏳ Executar `setupPlanilha()` para recriar abas com novos cabeçalhos
- ⏳ Reimplantar `Code.gs` como nova versão no Apps Script
- ⏳ Cadastrar operadores na aba `Operadores`
- ⏳ Testar fluxo completo

## Próximos passos
1. Testar fluxo completo com operadores reais
2. Módulo de Produção Diária (segundo módulo)
3. Dashboard de acompanhamento
4. Mapear etapas internas da Produção
