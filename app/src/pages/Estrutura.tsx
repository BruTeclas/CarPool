import { useState } from 'react'
import { Crud } from '../components/Crud'
import { useEmpresa } from '../lib/empresa'
import { useOpcoes } from '../lib/opcoes'

export default function Estrutura() {
  const { empresaId, podeGerir } = useEmpresa()
  const [versao, setVersao] = useState(0)
  const unidades = useOpcoes('unidades', 'id', 'nome', empresaId, versao)
  const bases = useOpcoes('bases', 'id', 'nome', empresaId, versao)
  const mudou = () => setVersao((v) => v + 1)

  return (
    <main>
      <h1>Filiais, bases e vagas</h1>
      <Crud titulo="Filiais" tabela="unidades" ordem="nome" podeEditar={podeGerir} aoMudar={mudou}
        campos={[{ nome: 'nome', rotulo: 'Nome', obrigatorio: true }]} />
      <Crud titulo="Bases (pátios)" tabela="bases" ordem="nome" podeEditar={podeGerir} aoMudar={mudou} versao={versao}
        campos={[
          { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
          { nome: 'unidade_id', rotulo: 'Filial', tipo: 'selecao', opcoes: unidades, obrigatorio: true },
          { nome: 'endereco', rotulo: 'Endereço' },
        ]} />
      <Crud titulo="Vagas" tabela="vagas" ordem="codigo" podeEditar={podeGerir} versao={versao}
        campos={[
          { nome: 'codigo', rotulo: 'Código da vaga', obrigatorio: true },
          { nome: 'base_id', rotulo: 'Base', tipo: 'selecao', opcoes: bases, obrigatorio: true },
        ]} />
      <Crud titulo="Assistência padrão (seguradora e guincho)" tabela="contatos_assistencia" ordem="criado_em" podeEditar={podeGerir}
        filtro={{ coluna: 'veiculo_id', nulo: true }}
        campos={[
          { nome: 'seguradora', rotulo: 'Seguradora ou empresa de assistência' },
          { nome: 'apolice', rotulo: 'Número da apólice' },
          { nome: 'telefone_assistencia', rotulo: 'Telefone da assistência (guincho)', obrigatorio: true },
          { nome: 'observacao', rotulo: 'Observação' },
        ]} />
      <p className="nota">Esse contato aparece para o motorista no botão de pane ou acidente. Para um carro com seguro diferente, cadastre na Frota.</p>
    </main>
  )
}
