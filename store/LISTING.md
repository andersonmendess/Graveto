# Ficha da Chrome Web Store — Graveto

Textos e respostas prontos para colar no [Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Pacote

- Arquivo: `dist/graveto-<versão>.zip`, gerado com `node scripts/package.mjs`
- Idioma padrão: Português (Brasil)

## Aba "Store listing"

**Nome:** Graveto

**Resumo** (vem do `description` do manifest, até 132 caracteres):

> VU meter, bass boost, reverb e slowed para o áudio e vídeo de qualquer página.

**Categoria:** Ferramentas (Tools)

**Descrição:**

```text
Graveto transforma o som de qualquer vídeo ou música que toca no navegador — YouTube, SoundCloud, Bandcamp, podcasts e qualquer player da web.

🎚 SLOWED + REVERB EM UM CLIQUE
Diminua a velocidade e o tom juntos (de 0,50× a 1,00×) e adicione reverb com o tamanho de sala que quiser. O clássico "slowed + reverb", ao vivo, em qualquer vídeo.

🔊 BASS BOOST SEM DISTORÇÃO
Até +18 dB de grave, com frequência ajustável de 40 a 200 Hz. Um limiter automático segura os picos para o som não estourar.

📊 VU METER ANALÓGICO
Dois mostradores clássicos, L e R, com agulha de balística real, LED de pico e alerta de clip.

⚡ PRESETS PRONTOS
Limpo, Grave, Slowed + Reverb e Sala. Use o botão de power para comparar com o áudio original.

🔒 PRIVADO
Todo o processamento acontece no seu navegador. Nenhum dado é coletado ou enviado.

Observações:
• Funciona com players HTML5 (<audio> e <video>).
• Conteúdo protegido por DRM (como Netflix e Spotify Web) não pode ser processado pelo navegador; nesses casos, só o Slowed funciona.
```

**Imagens** (geradas com `node scripts/store-assets.mjs`):

| Campo | Arquivo |
| --- | --- |
| Ícone da loja (128×128) | `icons/icon128.png` |
| Capturas de tela (1280×800) | `store/screenshot-1.png`, `store/screenshot-2.png` |
| Bloco promocional pequeno (440×280) | `store/promo-small-440x280.png` |
| Marquee (1400×560, opcional) | `store/promo-marquee-1400x560.png` |

**Site oficial:** https://github.com/andersonmendess/Graveto
**URL de suporte:** https://github.com/andersonmendess/Graveto/issues

## Aba "Privacy practices"

**Finalidade única:**

```text
Processar o áudio dos elementos <audio> e <video> das páginas em tempo real — bass boost, reverb, efeito slowed e medição de nível (VU meter) — controlado pelo popup da extensão.
```

**Justificativa — storage:**

```text
Guarda localmente as configurações dos efeitos (ligado/desligado, ganho do grave, mix do reverb, velocidade do slowed e volume) para que valham em todas as abas e persistam entre sessões.
```

**Justificativa — scripting:**

```text
Ao abrir o popup numa aba que já estava aberta antes da instalação ou atualização da extensão, injeta o mesmo content script empacotado (src/content.js) para ativar o processamento de áudio sem precisar recarregar a página. Nenhum código remoto é executado.
```

**Justificativa — permissões de host (<all_urls>):**

```text
O áudio que o usuário quer processar pode vir de qualquer site (YouTube, SoundCloud, podcasts, players embutidos). O content script precisa rodar em todas as páginas e frames para conectar os elementos <audio>/<video> ao grafo Web Audio e aplicar o playbackRate do efeito slowed. A extensão não lê o conteúdo das páginas, não coleta dados e não faz requisições de rede.
```

**Código remoto:** Não, não uso código remoto.

**Uso de dados:** não marque nenhuma categoria (a extensão não coleta dados) e marque as três
certificações:

- Não vendo nem transfiro dados de usuários a terceiros fora dos casos de uso aprovados.
- Não uso nem transfiro dados de usuários para fins não relacionados à finalidade única.
- Não uso nem transfiro dados de usuários para determinar crédito ou conceder empréstimos.

**Política de privacidade:** https://github.com/andersonmendess/Graveto/blob/main/PRIVACY.md

## Antes de enviar

1. Atualize `version` no `manifest.json` (cada envio precisa de uma versão maior).
2. `node scripts/package.mjs` e teste o zip em `chrome://extensions` → **Carregar sem compactação** (descompactado).
3. Envie o zip em **Package → Upload new package**, preencha as abas acima e clique em **Submit for review**.
