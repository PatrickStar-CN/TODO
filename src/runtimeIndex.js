function createEmptyCounts() {
  return { todo: 0, important: 0, all: 0, archived: 0 };
}

function createEmptyPublicIndex() {
  return { tagUndone: {}, tagTotal: {}, counts: createEmptyCounts() };
}

function addContribution(index, todo) {
  if (todo.tag) {
    index.tagTotal[todo.tag] = (index.tagTotal[todo.tag] || 0) + 1;
    if (!todo.done && !todo.archived) {
      index.tagUndone[todo.tag] = (index.tagUndone[todo.tag] || 0) + 1;
    }
  }
  if (todo.archived) {
    index.counts.archived++;
  } else if (!todo.done) {
    index.counts.all++;
    if (todo.todo) index.counts.todo++;
    if (todo.important) index.counts.important++;
  }
}

function decrement(record, key) {
  if (!key || record[key] == null) return;
  record[key]--;
  if (record[key] <= 0) delete record[key];
}

function removeContribution(index, todo) {
  if (todo.tag) {
    decrement(index.tagTotal, todo.tag);
    if (!todo.done && !todo.archived) decrement(index.tagUndone, todo.tag);
  }
  if (todo.archived) {
    index.counts.archived--;
  } else if (!todo.done) {
    index.counts.all--;
    if (todo.todo) index.counts.todo--;
    if (todo.important) index.counts.important--;
  }
}

function normalizeSearchText(todo) {
  return `${todo.title || ''}\n${todo.desc || ''}\n${todo.tag || ''}`.toLocaleLowerCase();
}

export function createRuntimeIndex(data) {
  const byId = new Map();
  const searchText = new Map();
  let version = 0;
  let calendarVersion = 0;

  function rebuild() {
    const index = createEmptyPublicIndex();
    byId.clear();
    searchText.clear();
    for (const todo of data.todos || []) {
      byId.set(todo.id, todo);
      searchText.set(todo.id, normalizeSearchText(todo));
      addContribution(index, todo);
    }
    data._index = index;
    version++;
    calendarVersion++;
    return index;
  }

  function ensure() {
    if (!data._index || byId.size !== (data.todos || []).length) rebuild();
    return data._index;
  }

  function get(id) {
    ensure();
    return byId.get(id);
  }

  function add(todo) {
    ensure();
    data.todos.push(todo);
    byId.set(todo.id, todo);
    searchText.set(todo.id, normalizeSearchText(todo));
    addContribution(data._index, todo);
    version++;
    calendarVersion++;
    return todo;
  }

  function update(todo, mutator, { calendar = true } = {}) {
    if (!todo) return null;
    ensure();
    const before = { ...todo };
    removeContribution(data._index, before);
    if (typeof mutator === 'function') mutator(todo);
    else if (mutator && typeof mutator === 'object') Object.assign(todo, mutator);
    addContribution(data._index, todo);
    byId.set(todo.id, todo);
    searchText.set(todo.id, normalizeSearchText(todo));
    version++;
    if (calendar) calendarVersion++;
    return todo;
  }

  function remove(id) {
    ensure();
    const todo = byId.get(id);
    if (!todo) return null;
    removeContribution(data._index, todo);
    const position = data.todos.indexOf(todo);
    if (position !== -1) data.todos.splice(position, 1);
    byId.delete(id);
    searchText.delete(id);
    version++;
    calendarVersion++;
    return todo;
  }

  function replaceTodos(todos) {
    data.todos = todos;
    rebuild();
  }

  function matches(todo, keyword) {
    ensure();
    return (searchText.get(todo.id) || normalizeSearchText(todo)).includes(keyword);
  }

  rebuild();

  return {
    add,
    ensure,
    get,
    matches,
    rebuild,
    remove,
    replaceTodos,
    update,
    getVersion: () => version,
    getCalendarVersion: () => calendarVersion
  };
}
