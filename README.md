# Alura Flow

> **Transforme cursos em podcasts e mantenha o foco.**
> Uma extensão para Firefox focada em ergonomia de estudo, acessibilidade e redução de atrito.

## O Conceito

Muitos cursos online consistem em vídeos que funcionam perfeitamente apenas como áudio ("modo podcast"), permitindo que o aluno absorva o conteúdo enquanto realiza tarefas mecânicas em outra aba do navegador. No entanto, a necessidade constante de voltar à aba do curso para clicar em "Próximo", responder um quiz simples ou ler um texto curto quebra esse estado de fluxo (flow).

A **Alura Flow** resolve isso trazendo o curso até você, e não o contrário. Ela permite controlar a reprodução globalmente e interagir com textos e quizzes através de popups minimalistas sobre sua aba atual.

## Funcionalidades Principais

### 1. Modo "Podcast" & Controle Global

Não procure mais a aba da Alura perdida entre outras 20 abas.

* **Auto-Play & Auto-Advance:** O próximo vídeo começa automaticamente.
* **Atalhos Globais:** Pause, avance ou mude a velocidade de qualquer lugar no navegador.

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
| `Ctrl` + `Alt` + **S** | **Speed Cycle** | Alterna velocidades (1.0x → 1.5x → 2.0x). |

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