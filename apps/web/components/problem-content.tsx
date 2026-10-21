'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Convert only fenced ASCII grid tables to real Markdown tables. Never execute HTML. */
function formatProblem(source: string): string {
  return source.replace(/```(?:text|plaintext)?\s*\n([\s\S]*?)\n```/g, (original, content: string) => {
    const lines = content.trimEnd().split('\n');
    const top = lines.findIndex(line => /^\s*\+(?:-+\+){2,}\s*$/.test(line));
    if (top < 0 || !lines[top + 1]?.trim().startsWith('|')) return original;
    const rows = lines.slice(top + 1).filter(line => /^\s*\|.*\|\s*$/.test(line));
    if (rows.length < 2) return original;
    const splitRow = (line: string) => line.trim().slice(1, -1).split('|').map(cell => cell.trim().replace(/\|/g, '\\|'));
    const cells = rows.map(splitRow), count = cells[0].length;
    if (count < 1 || cells.some(row => row.length !== count)) return original;
    const prefix = lines.slice(0, top).join('\n').trim();
    const table = [
      '| ' + cells[0].join(' | ') + ' |',
      '| ' + Array(count).fill('---').join(' | ') + ' |',
      ...cells.slice(1).map(row => '| ' + row.join(' | ') + ' |')
    ].join('\n');
    return (prefix ? prefix + '\n\n' : '') + table;
  });
}

export function ProblemContent({source}:{source:string}) {
  return <div className="arena-problem-prose">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatProblem(source)}</ReactMarkdown>
  </div>;
}
