# Alura Flow

> **Transforme cursos em podcasts e mantenha o foco.**
> Uma extensão para Firefox focada em ergonomia de estudo, acessibilidade e redução de atrito.

## O Conceito

Muitos cursos online consistem em vídeos que funcionam perfeitamente apenas como áudio ("modo podcast"), permitindo que o aluno absorva o conteúdo enquanto realiza tarefas mecânicas em outra aba do navegador. No entanto, a necessidade constante de voltar à aba do curso para clicar em "Próximo", responder um quiz simples ou ler um texto curto quebra esse estado de fluxo (flow).

A **Alura Flow** resolve isso trazendo o curso até você, e não o contrário. Ela permite controlar a reprodução globalmente e interagir com textos e quizzes através de popups minimalistas sobre sua aba atual.

## Funcionalidades Principais

### Novidades da versão 2.6.0

* **Companion pelo teclado:** <kbd>Espaço</kbd> ouve, inicia ou pausa a leitura; na leitura rápida, <kbd>←</kbd> volta ao início da frase e <kbd>→</kbd> pula para a próxima; nos quizzes, números ou letras escolhem a alternativa e <kbd>Enter</kbd> avança depois de acertar.
* **Quizzes em voz alta:** o companion lê a pergunta e as alternativas ("Alternativa A…"). No modo voz, com "Iniciar automaticamente" ligado, a leitura começa sozinha.
* **Visual renovado:** companion com cabeçalho que indica o tipo de aula, barra de controles fixa, ícones próprios, tempo restante na leitura rápida e acertos/erros indicados por texto, não só por cor. O popup prioriza a aula atual e a velocidade, com as demais opções em grupos recolhíveis.
* **Teclas de mídia:** as teclas de próxima e anterior faixa (teclado, fone de ouvido ou painel de mídia do sistema) trocam de aula durante os vídeos, mesmo com outro programa em primeiro plano. Pode ser desligado no popup.
* **Compatível com o novo layout da Alura:** aulas em endereços `/classpage/…` e páginas sem botão "Anterior" (o companion volta pela lista de aulas da barra lateral, inclusive no "Desfazer").
* **Avanço automático mais seguro:** se a Alura trocar de aula durante a contagem regressiva, a extensão não clica em "Avançar" de novo e não pula a aula seguinte.
* **Velocidade por curso de verdade:** ajustar a velocidade dentro de um curso não altera mais a velocidade padrão dos outros cursos.
* **Menos uso de CPU durante vídeos:** a detecção de quizzes deixou de reagir a cada atualização do player.

### Novidades da versão 2.5.8

* **Sessão segura por aba:** escolha exatamente qual curso o companion deve controlar.
* **Avanço com contagem regressiva:** cancele antes de avançar ou desfaça por oito segundos.
* **Perfis por curso:** a velocidade pode ser lembrada separadamente para cada curso.
* **Leitura configurável:** escolha a voz e ajuste o ritmo da narração sem alterar a velocidade dos vídeos.
* **Leitura rápida RSVP:** exiba uma palavra por vez com ponto focal destacado, velocidade ajustável e pausas inteligentes em pontuação.
* **Leitura da transcrição:** opcionalmente, ao terminar um vídeo, cancele o avanço nativo do player, aguarde a transcrição completa estabilizar e leia seu conteúdo em RSVP antes de avançar.
* **Configurações contextuais:** o popup mostra somente os ajustes relacionados ao modo escolhido e separa vídeos, leitura, atalhos e dados.
* **Início automático unificado:** a mesma opção controla aulas de texto e transcrições abertas depois de vídeos.
* **Transições protegidas:** telas de carregamento usam uma visualização neutra e nunca são enviadas ao TTS ou à leitura rápida.
* **Transcrição sem falso alerta:** enquanto o RSVP do vídeo está sendo preparado, a aula permanece em estado de espera e não aparece como tipo desconhecido.
* **RSVP clicável:** clique no próprio quadro de leitura rápida — ou use Enter/Espaço — para iniciar, pausar e retomar.
* **Controles estáveis:** o botão de iniciar, pausar ou retomar permanece centralizado mesmo quando seu texto muda.
* **Início RSVP consciente:** a leitura automática só começa com a companion visível e focada; fora do Firefox ela aguarda um clique e não rouba o foco.
* **Foco contextual:** a companion volta ao primeiro plano durante a navegação no Firefox, mas não interrompe o usuário quando outro programa está ativo.
* **Progresso local:** as últimas aulas abertas e concluídas ficam registradas somente no navegador.
* **Diagnóstico de seletores:** quando a Alura muda a estrutura de uma aula, a extensão mostra um aviso em vez de falhar silenciosamente.

### 1. Modo "Podcast" & Controle Global

Não procure mais a aba da Alura perdida entre outras 20 abas.

* **Auto-Play & Auto-Advance:** O próximo vídeo começa automaticamente.
* **Atalhos Globais:** Pause, avance ou mude a velocidade de qualquer lugar no navegador.

O fallback de `Ctrl+Alt+S` observa somente essa combinação de teclas nas páginas. Nenhum texto, formulário ou conteúdo dos sites é coletado.

### 2. Leitura Focada (Clean UI)

Quando uma lição de texto aparece, a extensão não te força a sair do seu contexto.

* Abre um **Popup Limpo** sobre sua aba atual.
* Remove menus laterais, gamificação e poluição visual da Alura.
* Foco total no texto, ideal para leitura rápida e retenção de conteúdo.

### 3. Quizzes Integrados

* Responda perguntas de múltipla escolha diretamente no popup.
* Receba feedback visual instantâneo (acerto/erro) sem carregar novas páginas.

### 4. 🚫 Anti-Cheat (Estudo Real)

Esta extensão **não** é um bot para pular cursos.

* Você **precisa** interagir: é necessário clicar para avançar nos textos e selecionar respostas nos quizzes.
* O objetivo é facilitar a interação, não removê-la.

---

## Atalhos de Teclado

Os atalhos funcionam mesmo que você esteja navegando em outro site (ex: lendo documentação ou no GitHub), desde que o Firefox esteja aberto.

| Atalho | Ação | Descrição |
| --- | --- | --- |
| `Ctrl` + `Alt` + **P** | **Play / Pause** | Pausa a reprodução do vídeo atual. |
| `Ctrl` + `Alt` + **N** | **Next Lesson** | Avança para a próxima lição (vídeo ou texto). |
| `Ctrl` + `Alt` + **S** | **Speed Cycle** | Alterna velocidades (1x → 1,25x → 1,5x → 2x). |
| ⏭ / ⏮ (teclas de mídia) | **Próxima / anterior aula** | Funcionam enquanto o vídeo da aula é a mídia ativa do Firefox, mesmo em outro programa. Play/pause continua com o comportamento padrão do Firefox. |

### No companion

| Tecla | Onde | Ação |
| --- | --- | --- |
| `Espaço` | Textos e quizzes | Ouvir, iniciar, pausar ou retomar a leitura. |
| `←` / `→` | Leitura rápida | Volta ao início da frase (ou à frase anterior) / pula para a próxima frase. |
| `1`–`9` ou `A`–`Z` | Quizzes | Escolhe a alternativa correspondente. |
| `Enter` | Quizzes | Avança para a próxima lição depois de acertar. |

Com o foco num botão, `Espaço` e `Enter` continuam acionando o botão.

---

## Instalação

Instale pela loja oficial: [Alura Flow no addons.mozilla.org](https://addons.mozilla.org/firefox/addon/alura-flow/).

### Modo de desenvolvimento

1. Baixe ou clone este repositório.
2. No Firefox, digite na barra de endereços: `about:debugging#/runtime/this-firefox`
3. Clique em **"Carregar manifesto temporário..."** (Load Temporary Add-on).
4. Selecione o arquivo `manifest.json` dentro da pasta do projeto.

## Configuração

Ao clicar no ícone da extensão na barra de ferramentas, você pode:

* Ajustar a velocidade padrão de reprodução (0.5x até 4.0x).
* Ativar/Desativar o avanço automático.
* Habilitar/Desabilitar os atalhos globais.
* Escolher a aba/curso controlado.
* Definir o atraso do avanço automático somente quando esse comportamento estiver ativo.
* Configurar separadamente voz, leitura rápida e velocidade RSVP das transcrições.
* Ativar a leitura RSVP da transcrição depois de vídeos que ofereçam esse conteúdo na barra lateral.
* Consultar e limpar, com confirmação, o histórico de progresso local.

## Validação para desenvolvimento

Requer Node.js. Instale as ferramentas uma vez com `npm install`.

| Comando | O que faz |
| --- | --- |
| `npm test` | Testes automáticos. Executam o `content.js`, o `background.js` e o companion reais sobre páginas de exemplo (`tests/fixtures`), com relógio simulado. |
| `npm run screenshots` | Gera capturas do companion e do popup em todos os estados, nos temas claro e escuro (`tests/preview/output/`). |
| `npm run lint` | Valida o pacote com as regras oficiais de extensões do Firefox (`web-ext lint`). |
| `npm run build` | Gera o `.zip` para enviar ao addons.mozilla.org (em `web-ext-artifacts/`). |
| `npm start` | Abre um Firefox temporário com a extensão carregada. |

### Teste no site real

Quando a Alura muda o layout, `npm run live:check` carrega a extensão num Firefox controlado, abre aulas reais e informa o que foi reconhecido (vídeo, texto, quiz, botões, transcrição), o que a extensão enviou ao companion e o que ele exibiu. Também salva uma cópia de cada página em `tests/live/output/` (fora do Git) para atualizar os exemplos de teste.

```bash
npm run live:login                       # entrar na Alura uma vez num perfil de teste separado
npm run live:discover -- https://cursos.alura.com.br/dashboard
npm run live:check -- <url de uma aula> --earlier --completed
```

O perfil de teste fica em `~/.alura-flow-live-profile`, com avanço e leitura automáticos desligados. Para não registrar progresso em aulas que você ainda não fez, `--earlier` abre só as aulas anteriores à indicada e `--completed` só as seções já concluídas. `--media-keys` e `--transcript` testam as teclas de mídia e a leitura da transcrição após o vídeo.

---

## Por que isso existe?

> *"O raciocínio difuso e pequenas doses de foco podem ajudar a fixar o conteúdo."*

Ambientes corporativos e rotinas de estudo intensas muitas vezes geram fadiga. A interface padrão de cursos (LMS) compete pela atenção do usuário. Ao simplificar a interface para janelas flutuantes de texto puro e permitir o controle de áudio em segundo plano, a **Alura Flow** busca auxiliar pessoas que:

* Preferem aprendizado auditivo.
* Sentem desconforto com interfaces poluídas (sensibilidade visual).
* Precisam otimizar o tempo de estudo sem perder a qualidade da absorção.

---

## Licença

Distribuído sob a [Licença MIT](LICENSE). Contribuições são bem-vindas. Componentes de terceiros estão listados em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
