import { useState } from 'react'
import { Crud } from '../components/Crud'
import { useEmpresa } from '../lib/empresa'
import { useOpcoes } from '../lib/opcoes'

const CNH = ['A', 'B', 'C', 'D', 'E'].map((c) => ({ valor: c, rotulo: c }))
const STATUS = [
  { valor: 'ativo', rotulo: 'Ativo' },
  { valor: 'manutencao', rotulo: 'Em manutenção' },
  { valor: 'bloqueado', rotulo: 'Bloqueado' },
  { valor: 'inativo', rotulo: 'Inativo' },
]

export default function Frota() {
  const { empresaId, podeGerir } = useEmpresa()
  const [versao, setVersao] = useState(0)
  const bases = useOpcoes('bases', 'id', 'nome', empresaId)
  const categorias = useOpcoes('categorias', 'id', 'nome', empresaId, versao)
  const veiculos = useOpcoes('veiculos', 'id', 'placa', empresaId, versao)

  return (
    <main>
      <h1>Frota</h1>
      <Crud titulo="Veículos" tabela="veiculos" ordem="placa" podeEditar={podeGerir} versao={versao} aoMudar={() => setVersao((v) => v + 1)}
        campos={[
          { nome: 'placa', rotulo: 'Placa', obrigatorio: true, placa: true, converter: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '') },
          { nome: 'modelo', rotulo: 'Modelo', obrigatorio: true },
          { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'selecao', opcoes: categorias, obrigatorio: true },
          { nome: 'base_id', rotulo: 'Base', tipo: 'selecao', opcoes: bases, obrigatorio: true },
          { nome: 'ano', rotulo: 'Ano', tipo: 'numero' },
          { nome: 'odometro_km', rotulo: 'Odômetro (km)', tipo: 'numero', obrigatorio: true },
          { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: STATUS, obrigatorio: true },
        ]} />
      <Crud titulo="Categorias" tabela="categorias" ordem="nome" podeEditar={podeGerir} aoMudar={() => setVersao((v) => v + 1)}
        campos={[
          { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
          { nome: 'cnh_minima', rotulo: 'CNH mínima', tipo: 'selecao', opcoes: CNH, obrigatorio: true },
        ]} />
      <Crud titulo="Assistência específica por veículo" tabela="contatos_assistencia" ordem="criado_em" podeEditar={podeGerir} versao={versao}
        filtro={{ coluna: 'veiculo_id', nulo: false }}
        campos={[
          { nome: 'veiculo_id', rotulo: 'Veículo', tipo: 'selecao', opcoes: veiculos, obrigatorio: true },
          { nome: 'seguradora', rotulo: 'Seguradora ou empresa de assistência' },
          { nome: 'apolice', rotulo: 'Número da apólice' },
          { nome: 'telefone_assistencia', rotulo: 'Telefone da assistência (guincho)', obrigatorio: true },
          { nome: 'observacao', rotulo: 'Observação' },
        ]} />
      <p className="nota">Use só quando o carro tem seguro ou guincho diferente do padrão da empresa (cadastrado em Filiais e bases).</p>
    </main>
  )
}
