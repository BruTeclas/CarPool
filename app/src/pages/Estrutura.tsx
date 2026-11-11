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
    </main>
  )
}
