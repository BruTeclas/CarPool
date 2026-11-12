const TRACOS: Record<string, string[]> = {
  reservar: ['M7 3v3M17 3v3', 'M4.5 9h15', 'M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M12 12.5v4M10 14.5h4'],
  reservas: ['M8.5 6.5h11M8.5 12h11M8.5 17.5h11', 'M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01'],
  aprovacoes: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M8.5 12.2l2.4 2.4 4.6-5'],
  portaria: ['M14.5 4a5.5 5.5 0 1 1-5.2 7.3L3.5 17v3.5H7V18h2.5v-2.5h2l1.2-1.2', 'M16.5 8.5h.01'],
  conferencia: ['M9 4.5h6v3H9z', 'M15 6h2.5a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.500V7.5A1.5 1.5 0 0 1 6.5 6H9', 'M9 13.5l2 2 4-4.5'],
  frota: ['M5 11l1.6-4.2A2 2 0 0 1 8.5 5.500h7a2 2 0 0 1 1.9 1.3L19 11', 'M4 11h16a1 1 0 0 1 1 1v4.5H3V12a1 1 0 0 1 1-1z', 'M6 16.5V19M18 16.500V19', 'M7 13.800h.01M17 13.800h.01'],
  etiquetas: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z', 'M14 14h2.500v2.500H14zM18 18h2v2h-2zM20 14v1.500M14 19.500V20'],
  estrutura: ['M5 20V6.500a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14 6.500V20', 'M14 10h3.500a1.5 1.5 0 0 1 1.5 1.5V20', 'M3.5 20h17', 'M8 9h3M8 12.500h3M8 16h3'],
  pessoas: ['M9 11.500a3.25 3.25 0 1 0 0-6.500 3.25 3.25 0 0 0 0 6.500z', 'M3.5 19.500a5.500 5.500 0 0 1 11 0', 'M16 5.300a3.25 3.25 0 0 1 0 6.100', 'M17.500 14.300a5.500 5.500 0 0 1 3 5.200'],
  grupos: ['M12 4l8 4-8 4-8-4 8-4z', 'M4 12l8 4 8-4', 'M4 16l8 4 8-4'],
  politicas: ['M12 3.500l7 2.600v5.400c0 4.300-2.900 7.400-7 9-4.100-1.600-7-4.700-7-9V6.100l7-2.600z', 'M9 12l2.200 2.200L15 10'],
  perfil: ['M12 12a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7z', 'M5.500 19.500a6.500 6.500 0 0 1 13 0'],
  sair: ['M14 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7', 'M10.500 12H20', 'M17 8.500l3.500 3.500-3.500 3.500'],
  chave: ['M14.5 4a5.5 5.5 0 1 1-5.2 7.3L3.5 17v3.5H7V18h2.5v-2.5h2l1.2-1.2', 'M16.5 8.5h.01'],
}

export function Icone({ nome, tamanho = 20 }: { nome: string; tamanho?: number }) {
  const tracos = TRACOS[nome]
  if (!tracos) return null
  return (
    <svg className="icone" width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tracos.map((d) => <path key={d} d={d} />)}
    </svg>
  )
}
