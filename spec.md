
# Spec: automação diária das sessões da Evolution → Radar Mobiliza PE

**Status:** rascunho de arquitetura (v2, pós-reunião)
**Responsável pela construção:** Pedro Abib
**Prioridade:** alta

## Contexto

Hoje a triagem do que vira caso no Radar é manual: alguém da Central precisa perceber, no meio da conversa privada com cada contato, o que merece virar caso e registrar. Isso não escala — na semana de 11 a 14/08 a base Botando pra Moer (onde a frente de IR registra contatos manualmente) teve 110 contatos, dos quais 15 teriam cara de caso pelo teor da conversa, e apenas 2 chegaram no Radar.

A decisão tomada é substituir esse julgamento manual por leitura automática: a Evolution (WhatsApp) lê o privado de todas as sessões da Central em PE, julga o que é digno de virar caso e alimenta sozinha a base Radar Mobiliza PE.

## Objetivo

Fechar a distância entre "o que aconteceu nas conversas" e "o que vira caso no Radar", sem exigir que alguém do time preencha formulário ou faça triagem caso a caso.

**Métrica de calibração:** rodar o motor contra o histórico de 11–14/08 e comparar a saída com os 15 contatos que a Maíra julgaria dignos de caso naquela semana. O motor está calibrado quando bate perto desse número, não quando bate perto dos 2 que o Radar recebeu hoje (esse número reflete o gargalo manual, não o critério certo).

## Modelo de dados (v2)

Depois de uma rodada de refinamento, o desenho ficou mais simples que a v1 deste spec:

- **Tabela "todos os contatos" (Google Sheets):** registra diariamente todo contato de entrada nas caixas das sessões listadas da Evolution — uma linha por contato/conversa, com propriedades que descrevem a conversa e uma propriedade calculada pelo critério.
- **Propriedade de roteamento:** o critério, ao rodar sobre a conversa, escreve uma propriedade nessa mesma linha (ex.: "precisa resposta / já respondido"). Não existe mais uma etapa separada de "filtro" — é a própria propriedade que decide se aquele contato deve ir para o Radar.
- **Radar Mobiliza PE (Notion):** recebe só os contatos cuja propriedade indica que precisam de resposta institucional e ainda não têm. É esse subconjunto filtrado, de volume bem menor, que fica em Notion — porque é onde humanos (a coordenação) leem e respondem.

**Por que Sheets para a tabela de contatos, e não Notion:** essa tabela registra automaticamente TODO contato das três sessões, todo dia — volume bem maior do que o registro manual da Botando pra Moer gerava, que foi o que tornou a Botando pra Moer pesada a ponto de precisar ser particionada por semana. Colocar o alto volume em Sheets e manter só o subconjunto filtrado (Radar) em Notion resolve o problema na raiz, em vez de reproduzi-lo com outra tecnologia.

**Em aberto:** qual é a relação entre essa tabela nova e a Botando pra Moer que já existe hoje (particionada por semana, mantida pela frente de IR)? Substitui, roda em paralelo, ou a Botando pra Moer passa a ser alimentada a partir dessa tabela? Vale alinhar com a Maíra antes de construir, pra não duplicar trabalho que a IR já faz.

## Etapas gerais

A tarefa como um todo, do início ao fim:

1. **Conectar tudo de volta na Evolution** — ingestão funcionando (backfill + diário) para as três sessões
2. **Registrar diariamente todos os contatos** na tabela Sheets, com a propriedade de roteamento calculada pelo critério
3. **Levar pro Radar Mobiliza PE** os contatos cuja propriedade indica que precisam de resposta institucional e ainda não têm

## Pessoas e responsabilidades

- **Lucas** — definiu o requisito e a urgência
- **Maíra Kamilly** — dona do critério de curadoria (já aplica na mão); referência principal para calibrar o motor
- **Thiago Bergamini Paiva** — orienta a condução do projeto
- **Vitória Estênio** — acompanha
- **Pedro Abib** — constrói a automação

## Arquitetura

### 1. Ingestão (n8n)

Dois workflows, mesmas peças reaproveitadas:

- **Backfill (execução única):** para cada sessão (Mobiliza, IR, Regionais), enumera todos os chats/contatos e puxa o histórico completo de mensagens de cada um, paginado. Ao final de cada chat, grava o transcript e um checkpoint com o timestamp da última mensagem lida.
- **Diário (agendado):** relista os chats de cada sessão, filtra só os que tiveram atividade nova desde o checkpoint salvo, puxa apenas as mensagens novas e as soma ao transcript existente daquele chat (o julgamento precisa do contexto completo da conversa, não só do que chegou no dia). Atualiza o checkpoint depois do julgamento.

Checkpoint e transcript ficam na mesma planilha Sheets da etapa 2 (ou numa aba auxiliar dela), chaveado por sessão + contato, evitando outra peça de infraestrutura.

**A mapear:** como as sessões Mobiliza/IR/Regionais estão representadas na Evolution (instâncias separadas ou chats dentro de uma instância única), e se a Evolution expõe webhook de mensagem nova (o que permitiria trocar parte do polling diário por um listener em tempo real).

### 2. Registro em Sheets + propriedade de roteamento

Para cada contato de cada sessão, a automação escreve (ou atualiza) uma linha na planilha "todos os contatos", com campos como: sessão, contato, timestamp da última mensagem, quem mandou a última mensagem, e a propriedade calculada pelo critério.

O critério tem uma camada bem mecânica (a última mensagem da conversa é da pessoa de fora, e ninguém da sessão respondeu depois — dá quase pra checar por timestamp e remetente) e uma camada de julgamento mais fina por cima (se aquele contato sem resposta de fato precisa de uma, ou é algo que não pede ação — spam, off-topic, resolvido em outro canal). Essa segunda camada reaproveita o motor do Centro de Pendências (automação já existente do Lucas, que analisa as conversas dele todo dia e decide sozinho o que vira pendência) e é construída com a Maíra e o Thiago, usando a Botando pra Moer das últimas semanas como referência de calibração.

Chave de linha: sessão + contato (telefone/remoteJid) — precisa de upsert (procurar linha existente antes de inserir) pra não duplicar em cada rodada diária.

**A mapear:** schema exato da planilha (colunas), e se cada sessão vira uma aba separada ou tudo numa aba só com coluna de sessão.

### 3. Levar pro Radar Mobiliza PE

Quando a propriedade de roteamento de uma linha indica "precisa resposta institucional, ainda sem resposta", essa linha é escrita (ou atualizada) na base Radar Mobiliza PE no Notion, já classificada por urgência e área. Uma coluna extra na própria planilha (ex.: "já enviado ao Radar") evita reenviar a mesma linha em rodadas seguintes.

### 4. Calibração e staging

Antes de qualquer linha virar oficial no Radar, passa por uma revisão com marcação de **Autorizado** ou **Ressalva** — dá pra ver o que a máquina decidiu e corrigir antes de virar oficial. Pode viver como uma coluna extra na própria planilha, já que não existe mais uma base intermediária separada. Calibração roda em 2 a 3 rodadas: a máquina julga, quem conhece o critério (Maíra/Thiago) marca acerto, falso positivo e o que passou batido, e o critério se ajusta.

### 5. Produção — Radar Mobiliza PE

Depois de calibrado, o motor roda sozinho todo dia. A coordenação da campanha lê pelo painel de campo e responde pela própria tela; a devolutiva volta pra mesma linha, assinada.

**A mapear:** schema alvo da base Radar Mobiliza PE (campos de urgência, área, e o que precisa bater com o que o painel de campo já lê).

### 6. Painel de campo (mudança condicional)

A aba Radar do painel hoje diz "a Central registra aqui". Só trocar essa frase quando a leitura diária e completa estiver de pé e estável — antes disso a frase promete cobertura que ainda não existe. Ajuste é de uma frase, em `painel-pe/index.html` no repositório `lucastnl/painel-pe`.

## Escopo e não-escopo

- **É:** ler o privado das sessões, registrar todo contato, decidir o que ainda não tem resposta institucional e precisa de uma, alimentar o Radar já classificado.
- **Não é:** copiar a base inteira pro Radar. Conversa operacional continua onde já está — o Radar carrega só o que precisa de resposta de alguém de fora.

## Fases de execução

1. Alinhar com a Maíra a relação entre a tabela nova e a Botando pra Moer existente; mapear schema alvo da Radar Mobiliza PE
2. Construir o backfill e o diário da ingestão (Etapa 1), rodando contra o histórico existente
3. Construir o registro em Sheets com a propriedade de roteamento (Etapa 2), primeiro só com a camada mecânica (sem resposta + tempo)
4. Escrever a camada de julgamento fino do critério com Maíra e Thiago, usando a Botando pra Moer como referência (Etapa 2, parte 2)
5. Rodar 2–3 rodadas de calibração contra a coluna Autorizado/Ressalva, medindo contra o número de referência (15 casos na semana de 11–14/08)
6. Ligar o job diário rodando sozinho, escrevendo direto na Radar Mobiliza PE (Etapa 3)
7. Só então, trocar a frase do painel de campo
