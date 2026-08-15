# Automação diária das sessões da Evolution: o privado vira caso no Radar

Criado em: August 15, 2026 10:35 AM
Prazo: August 15, 2026
Prioridade: 🔥🔥🔥 Alta
Responsáveis: Pedro Abib
Status: Não iniciada
Última edição: August 15, 2026 10:37 AM

<aside>
📡

Todo dia, a Evolution roda o privado de todas as sessões da Central em PE, lê o que chegou, julga o que é digno de virar caso e alimenta sozinha a base **Radar Mobiliza PE**, que já está ligada ao painel de campo.

</aside>

@Pedro Abib constrói. @Maíra Kamilly passa o critério, que ela já aplica na mão. @Thiago bergamini paiva orienta a condução. @Vitória Estênio acompanha.

## A decisão que muda o desenho, tomada hoje

**O formulário acaba.** Ninguém do time preenche caso a caso e ninguém do time faz a triagem. Nas palavras do Lucas, em 15/08:

> eu preciso que ele analise todas as interações do um a um e que a ferramenta julgue, porque isso é algo pra ser feito não no olho, é pra ser feito pela Evolution
> 

E o tamanho da coisa, pra calibrar a expectativa:

> é um check diário como eu construí aqui pra mim, ele analisa todas as minhas conversas do WhatsApp, tipo as minhas duzentas, inclusive é menos trabalho do que o que eu tô fazendo pra mim
> 

## O método já existe, em dois lugares

O motor é o mesmo do **Centro de Pendências** do Lucas, que roda as conversas dele todo dia e decide sozinho o que vira pendência.

O critério já está provado na mão, na base **Botando pra Moer**, onde a frente de IR registra os contatos de um a um todo dia. Nas palavras dele:

> é basicamente fazer o que vocês já fizeram, só que automático. Só isso.
> 

## Os passos

1. **Ler o histórico completo** de todas as sessões, e não só o que chegar de hoje em diante. São as sessões Mobiliza, IR e Regionais.
2. **Absorver a Botando pra Moer** como referência do critério, porque ela é exatamente a mesma tarefa feita à mão.
3. **Escrever o critério com quem já faz.** A Maíra fez a curadoria e sabe dizer o que é digno de subir. O Thiago orienta a condução.
4. **Calibrar em duas ou três rodadas.** A máquina joga, quem conhece marca o que ela acertou, o que não era caso e o que ela deixou passar, e o critério se ajusta.
5. **Base de autorização nos primeiros dias.** Antes de entrar na base diária, o que a máquina decidiu passa por uma coluna de **Autorizado** ou **Ressalva**, pra dar pra ver o que ela jogou e corrigir antes de virar oficial.
6. **Rodar sozinha todo dia**, com o caso caindo no Radar já classificado por urgência e por área.
7. **Trocar a frase do painel, e só quando a automação estiver de pé.** A aba Radar do painel de campo hoje diz à campanha que *"a Central registra aqui"*. Quando a leitura passar a ser diária e completa, essa frase vira o argumento mais forte da tela, porque deixa de ser o que alguém lembrou de registrar e passa a ser tudo que chegou no privado. Antes disso ela não muda, senão promete cobertura que ainda não existe. O ajuste é de uma frase, no `painel-pe/index.html` do repositório `lucastnl/painel-pe`.

## Onde cai

Na base **Radar Mobiliza PE**, dentro da página 📡 Radar da Central. A coordenação da campanha lê pelo painel de campo e devolve a resposta institucional pela própria tela, e a devolutiva volta pra mesma linha, assinada.

## A ordem de grandeza, pra quando o critério for escrito

Na semana de 11 a 14/08 a Botando pra Moer registrou **110 contatos**. Pelo teor da conversa, **15** teriam cara de caso pro Radar. O Radar recebeu **2**. É essa distância que a automação fecha.

<aside>
⚠️

**O que isto não é.** Não é copiar base inteira pro Radar. O Radar carrega o que pede atenção ou decisão de alguém de fora, e conversa operacional continua onde já está.

</aside>