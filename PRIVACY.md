# Política de privacidade — Graveto

_Última atualização: 16 de outubro de 2026_

O Graveto é uma extensão do Chrome que processa localmente o áudio de elementos
`<audio>` e `<video>` das páginas que você visita (VU meter, bass boost, reverb e slowed).

## Dados que o Graveto acessa

**Conteúdo do site (áudio e vídeo).** Para aplicar os efeitos, o Graveto processa o som
dos elementos `<audio>` e `<video>` das páginas que você visita e ajusta a velocidade
de reprodução deles (efeito slowed). Esse processamento:

- acontece em tempo real, só dentro do seu navegador, pela Web Audio API;
- não grava, não armazena e não envia o áudio, o vídeo ou qualquer outro conteúdo da
  página para servidores ou terceiros;
- não lê textos, formulários, endereços nem o histórico das páginas.

Além disso, o Graveto guarda apenas as suas configurações dos efeitos (por exemplo,
ganho do grave e mix do reverb) em `chrome.storage.local`, no seu computador.

O Graveto **não coleta** informações de identificação pessoal, de saúde, financeiras,
de autenticação, comunicações pessoais, localização, histórico de navegação nem
atividade do usuário. A extensão não faz requisições de rede, não usa analytics e não
carrega código remoto.

## Uso e compartilhamento

Os dados acima são usados só para a finalidade única da extensão: processar o áudio que
toca na página. Eles não são vendidos, transferidos a terceiros, usados para publicidade
nem para determinar crédito ou conceder empréstimos.

## Permissões

- **storage** — guardar as configurações dos efeitos no seu navegador.
- **scripting** — ativar o processamento de áudio em abas que já estavam abertas antes
  da instalação, quando você abre o popup.
- **Acesso a todos os sites** — necessário para processar o áudio dos players de
  qualquer site. A extensão só interage com os elementos de áudio e vídeo da página.

## Contato

Dúvidas ou pedidos: abra uma issue em
<https://github.com/andersonmendess/Graveto/issues>.
