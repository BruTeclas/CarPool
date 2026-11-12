// Armazenamento no aparelho (IndexedDB): um cache de leitura e uma fila de envios pendentes.
const NOME = 'carpool'

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const pedido = indexedDB.open(NOME, 1)
    pedido.onupgradeneeded = () => {
      pedido.result.createObjectStore('cache')
      pedido.result.createObjectStore('fila', { autoIncrement: true })
    }
    pedido.onsuccess = () => ok(pedido.result)
    pedido.onerror = () => falha(pedido.error)
  })
}

async function operar<T>(loja: 'cache' | 'fila', modo: IDBTransactionMode, acao: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await abrir()
  return new Promise<T>((ok, falha) => {
    const pedido = acao(db.transaction(loja, modo).objectStore(loja))
    pedido.onsuccess = () => ok(pedido.result as T)
    pedido.onerror = () => falha(pedido.error)
  })
}

export const guardar = (chave: string, valor: unknown) => operar<IDBValidKey>('cache', 'readwrite', (s) => s.put(valor, chave))
export const ler = <T>(chave: string) => operar<T | undefined>('cache', 'readonly', (s) => s.get(chave))

export async function enfileirar(item: unknown): Promise<void> {
  await operar<IDBValidKey>('fila', 'readwrite', (s) => s.add(item))
  window.dispatchEvent(new Event('carpool-fila'))
}

export async function lerFila<T>(): Promise<{ id: number; item: T }[]> {
  const [ids, itens] = await Promise.all([
    operar<IDBValidKey[]>('fila', 'readonly', (s) => s.getAllKeys()),
    operar<T[]>('fila', 'readonly', (s) => s.getAll()),
  ])
  return ids.map((id, i) => ({ id: id as number, item: itens[i] }))
}

export async function removerDaFila(id: number): Promise<void> {
  await operar<undefined>('fila', 'readwrite', (s) => s.delete(id))
  window.dispatchEvent(new Event('carpool-fila'))
}
