# Política de privacidade — Graveto

_Última atualização: 16 de outubro de 2026_

O Graveto é uma extensão do Chrome que processa localmente o áudio de elementos
`<audio>` e `<video>` das páginas que você visita (VU meter, bass boost, reverb e slowed).

## Dados coletados

**Nenhum.** O Graveto não coleta, armazena, transmite, vende nem compartilha dados
pessoais ou de navegação.

- O áudio é processado em tempo real dentro do próprio navegador, pela Web Audio API.
  Nada é gravado nem enviado para servidores.
- A única informação guardada são as suas configurações dos efeitos (por exemplo,
  ganho do grave e mix do reverb), em `chrome.storage.local`, no seu computador.
- A extensão não faz requisições de rede, não usa analytics e não carrega código remoto.

## Permissões

- **storage** — guardar as configurações dos efeitos no seu navegador.
- **scripting** — ativar o processamento de áudio em abas que já estavam abertas antes
  da instalação, quando você abre o popup.
- **Acesso a todos os sites** — necessário para processar o áudio dos players de
  qualquer site. A extensão só interage com os elementos de áudio e vídeo da página.

## Contato

Dúvidas ou pedidos: abra uma issue em
<https://github.com/andersonmendess/Graveto/issues>.
