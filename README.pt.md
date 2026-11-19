# Gerenciador de arquivos do espaço de trabalho (aprimorado)

[English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md) · **Português**

> **Nota do fork (tyly324):** este repositório é um fork de [Arrosam/dsh-better-workspace-file-manager](https://github.com/Arrosam/dsh-better-workspace-file-manager). Ele adiciona confirmação do destino do envio, progresso e nova tentativa, fechamento automático do diálogo de exclusão, além de recortar/copiar/colar, renomear, comprimir/extrair ZIP, propriedades e nova pasta. Mesma licença MIT do original.

Gerenciador de arquivos para a aba **Arquivos** do DSH Web e o painel de visualização. Adiciona as operações de escrita que faltam na árvore oficial sem alterar o DOM dela.

## Recursos

- **Envio** por botão, arrastando do computador ou soltando uma pasta. Primeiro confirma a pasta de destino (a selecionada ou a raiz do espaço de trabalho), depois mostra progresso por arquivo, motivo da falha e **Tentar novamente**.
- **Seleção múltipla** com clique, ⌘/Ctrl+clique, Shift+clique ou arrastando sobre a área vazia.
- **Download** de um arquivo, de uma seleção ou de uma pasta inteira como ZIP em streaming.
- **Nova pasta** pelo menu de contexto ou botão do cabeçalho; cria na última pasta selecionada, senão na raiz.
- **Excluir** após confirmação. O diálogo sempre fecha ao final; se a linha já não existia, fecha e atualiza a lista.
- **Recortar / copiar / colar / renomear**: em conflito de nome, `name (1).ext`, nunca sobrescreve.
- **Comprimir / extrair ZIP**: antes de extrair, valida `..`, caminhos absolutos, links simbólicos e entradas criptografadas.
- **Propriedades**: nome, tipo, tamanho (número de itens em pastas), data de modificação, permissões e caminho absoluto.
- **Mover arrastando / arrastar para o chat**: solte sobre uma pasta para mover; solte na caixa de texto para adicionar uma referência `@path`.
- **Visualização**: download em cada visualização; edição no local de texto/código/Markdown preservando fins de linha e BOM, com detecção de conflito e salvamento manual ou automático a cada 5 s.

## Instalação

```sh
dsh plugin --profile web add @tyly324/dsh-better-workspace-file-manager
```

Requisitos: perfil **Web** do DSH **0.2.1-rc.3 ou superior** (testado com 0.2.2-rc.1), sistema de arquivos local do Host (fs-local / fs-sandbox) e Node.js 20.15+.

## Observações e limites

- Apenas **ZIP** padrão; ZIP64, ZIP criptografado, 7z e rar não são suportados.
- 2 GiB por arquivo/arquivo compactado e no máximo 10 000 entradas; para trabalhos maiores use o terminal.
- A exclusão é **permanente**, sem lixeira.
- A área de transferência de arquivos vale só para a página atual e é limpa ao recarregar.
- O tamanho de uma pasta mostra o número de itens diretos, não o total recursivo.

## Licença

MIT, baseado em Arrosam/dsh-better-workspace-file-manager. A documentação completa em inglês está em [README.md](README.md).
