// Must run before mounting a reader: old local recovery copies refer to the replaced DB.
export function syncStorageEpoch(storage, epoch) {
  if (!epoch || storage.getItem('keeper.storage.epoch') === epoch) return;
  if (epoch !== 'original') {
    const remove = [];
    for (let i=0;i<storage.length;i++) {
      const key = storage.key(i);
      if (key?.startsWith('keeper.answer.draft:') || key?.startsWith('keeper.essay.draft:') || ['keeper.lastReading','keeper.reader.progress'].includes(key)) remove.push(key);
    }
    for (const key of remove) storage.removeItem(key);
  }
  storage.setItem('keeper.storage.epoch',epoch);
}
