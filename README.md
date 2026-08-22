# Alura Flow

> **Transforme cursos em podcasts e mantenha o foco.**
> Uma extensão para Firefox focada em ergonomia de estudo, acessibilidade e redução de atrito.

## O Conceito

Muitos cursos online consistem em vídeos que funcionam perfeitamente apenas como áudio ("modo podcast"), permitindo que o aluno absorva o conteúdo enquanto realiza tarefas mecânicas em outra aba do navegador. No entanto, a necessidade constante de voltar à aba do curso para clicar em "Próximo", responder um quiz simples ou ler um texto curto quebra esse estado de fluxo (flow).

A **Alura Flow** resolve isso trazendo o curso até você, e não o contrário. Ela permite controlar a reprodução globalmente e interagir com textos e quizzes através de popups minimalistas sobre sua aba atual.

## Funcionalidades Principais

### Novidades da versão 2.5.5

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

---

## Instalação (Desenvolvimento)

Como a extensão ainda não está na loja oficial do Firefox, você pode instalá-la em modo de depuração:

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

Os testes de regressão usam apenas o Node.js e cobrem a identificação de respostas corretas/incorretas, quizzes de múltipla escolha, roteamento de abas e identidade das aulas:

```bash
node --test tests/core.test.mjs
```

Para validar o pacote com as regras oficiais de extensões do Firefox:

```bash
web-ext lint --source-dir .
```

---

## Por que isso existe?

> *"O raciocínio difuso e pequenas doses de foco podem ajudar a fixar o conteúdo."*

Ambientes corporativos e rotinas de estudo intensas muitas vezes geram fadiga. A interface padrão de cursos (LMS) compete pela atenção do usuário. Ao simplificar a interface para janelas flutuantes de texto puro e permitir o controle de áudio em segundo plano, a **Alura Flow** busca auxiliar pessoas que:

* Preferem aprendizado auditivo.
* Sentem desconforto com interfaces poluídas (sensibilidade visual).
* Precisam otimizar o tempo de estudo sem perder a qualidade da absorção.

---

## Licença

Este projeto é de código aberto. Sinta-se livre para contribuir ou modificar para seu uso pessoal.
