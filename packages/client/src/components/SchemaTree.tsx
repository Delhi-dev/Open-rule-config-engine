import type { SchemaNode } from '@rule-engine/core';

export function SchemaTree({ root, onSelect }: { root: SchemaNode; onSelect?: (node: SchemaNode) => void }) {
  const children = root.path ? [root] : root.children ?? [];
  return (
    <div className="tree">
      {children.map((c) => (
        <TreeNode key={c.path} node={c} onSelect={onSelect} />
      ))}
    </div>
  );
}

function TreeNode({ node, onSelect }: { node: SchemaNode; onSelect?: (node: SchemaNode) => void }) {
  const isContainer = node.type === 'object' || node.type === 'array';
  const label = node.type === 'array' ? `${node.name}[]` : node.name;
  return (
    <div>
      <div
        className="node"
        style={{ cursor: onSelect ? 'pointer' : 'default' }}
        onClick={() => onSelect?.(node)}
        title={node.description ?? node.path}
      >
        <span>{label}</span>
        <span className="type">{node.type}</span>
        {node.required && <span className="req">*</span>}
        {node.enum && <span className="enum">{`{${node.enum.join('|')}}`}</span>}
      </div>
      {isContainer && node.children && node.children.length > 0 && (
        <div className="children">
          {node.children.map((c) => (
            <TreeNode key={c.path} node={c} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
