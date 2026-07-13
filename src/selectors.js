const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, none: 3 };

function getTodoArray(source) {
  return Array.isArray(source) ? source : (source?.todos || []);
}

export function sortByPriority(todos) {
  return todos.slice().sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority || 'none'];
    const pb = PRIORITY_ORDER[b.priority || 'none'];
    if (pa !== pb) return pa - pb;
    return b.createdAt - a.createdAt;
  });
}

export function getFilteredTodos(data, currentList, currentTag) {
  if (currentTag) {
    return data.todos.filter(t => t.tag === currentTag && !t.archived);
  }
  switch (currentList) {
    case 'todo':
      return data.todos.filter(t => t.todo && !t.archived);
    case 'important':
      return data.todos.filter(t => t.important && !t.archived);
    case 'archived':
      return data.todos.filter(t => t.archived);
    case 'all':
      return data.todos.filter(t => !t.archived);
    default:
      return data.todos.filter(t => !t.archived);
  }
}

export function countByList(todos) {
  if (todos && todos._index && todos._index.counts) {
    return { ...todos._index.counts };
  }
  let todo = 0;
  let important = 0;
  let all = 0;
  let archived = 0;
  for (const t of getTodoArray(todos)) {
    if (t.archived) {
      archived++;
      continue;
    }
    if (t.done) continue;
    all++;
    if (t.todo) todo++;
    if (t.important) important++;
  }
  return { todo, important, all, archived };
}

export function countTagUndone(todos, tag) {
  if (todos && todos._index && todos._index.tagUndone) {
    return todos._index.tagUndone[tag] || 0;
  }
  let count = 0;
  for (const t of getTodoArray(todos)) {
    if (t.tag === tag && !t.done && !t.archived) count++;
  }
  return count;
}

export function splitPendingDone(todos) {
  const pending = [];
  const done = [];
  for (const t of todos) {
    if (t.done) done.push(t);
    else pending.push(t);
  }
  done.sort((a, b) => {
    const ta = a.doneAt ? new Date(a.doneAt).getTime() : 0;
    const tb = b.doneAt ? new Date(b.doneAt).getTime() : 0;
    return tb - ta;
  });
  return { pending, done };
}
