import { driven } from '../create/renderer'
import { BASIC_TYPES } from './basic'
import { MORE_TYPES } from './more'
import { TEX_TYPES } from './texnodes'
import { GEO_TYPES } from './geonodes'
import { CUSTOM_TYPES, customType } from './custom'
import type { NodeState, NodeType } from './kit'

export * from './kit'

// Every node type, in the order the palette shows them.
export const NODE_TYPES: NodeType[] = [...BASIC_TYPES, ...MORE_TYPES, ...TEX_TYPES, ...GEO_TYPES, ...CUSTOM_TYPES]

const byType = new Map(NODE_TYPES.map((t) => [t.type, t]))
export const nodeType = (t: string): NodeType | undefined => byType.get(t) ?? (t.startsWith('custom:') ? customType(t.slice(7)) : undefined)

// What a node leaves behind when it is deleted or its network stops.
export function releaseNode(type: string, state: NodeState, id = '') {
  if (type === 'create' && typeof state.target === 'string') driven.delete(state.target)
  nodeType(type)?.release?.(state, id)
}
