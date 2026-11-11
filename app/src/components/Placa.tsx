/** Placa no padrão Mercosul. É o elemento de identidade do sistema: use sempre que mostrar um veículo. */
export function Placa({ valor }: { valor?: string | null }) {
  if (!valor) return null
  const texto = valor.length === 7 ? `${valor.slice(0, 3)} ${valor.slice(3)}` : valor
  return <span className="placa" aria-label={`Placa ${valor}`}>{texto}</span>
}

export function Veiculo({ placa, modelo }: { placa?: string | null; modelo?: string | null }) {
  return (
    <span className="veiculo">
      <Placa valor={placa} />
      {modelo && <span className="veiculo-modelo">{modelo}</span>}
    </span>
  )
}
