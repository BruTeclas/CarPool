import { Crud } from '../components/Crud'
import { useEmpresa } from '../lib/empresa'
import { useOpcoes } from '../lib/opcoes'

const SIM_NAO = [{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }]

export default function Checklist() {
  const { empresaId, podeGerir } = useEmpresa()
  const categorias = useOpcoes('categorias', 'id', 'nome', empresaId)

  return (
    <main>
      <h1>Checklist da vistoria</h1>
      <p>Monte a lista que o condutor responde na saída e na chegada. Sem nenhum item cadastrado, vale a lista padrão do sistema.</p>
      <p>Se uma categoria tiver itens próprios, os veículos dela usam só esses. As demais usam os itens sem categoria. Item de segurança reprovado bloqueia o veículo.</p>
      <Crud titulo="Itens" tabela="checklist_itens" ordem="ordem" podeEditar={podeGerir}
        campos={[
          { nome: 'item', rotulo: 'Item', obrigatorio: true },
          { nome: 'categoria_id', rotulo: 'Só para a categoria', tipo: 'selecao', opcoes: categorias },
          { nome: 'critico', rotulo: 'Item de segurança', tipo: 'selecao', opcoes: SIM_NAO, obrigatorio: true, converter: (v) => v === 'true' },
          { nome: 'ordem', rotulo: 'Ordem', tipo: 'numero', obrigatorio: true },
          { nome: 'ativo', rotulo: 'Ativo', tipo: 'selecao', opcoes: SIM_NAO, obrigatorio: true, converter: (v) => v === 'true' },
        ]} />
    </main>
  )
}
