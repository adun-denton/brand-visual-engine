import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';

/** OS-released SQLite exclusive lock, containing no project/job data. Never steal a live lock. */
export class RuntimeOwner {
  private db: DatabaseSync;
  private active = true;
  private leases = 0;
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    assertNoLinks(this.root);
    mkdirSync(this.root, {recursive:true});
    // Keep the OS lock outside the authoritative runtime: legacy byte inventories stay exact.
    const path=join(dirname(this.root),'.'+basename(this.root)+'.bve-writer.lock'); assertNoLinks(path);
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;');
    } catch {
      this.db.close(); this.active=false;
      throw Error('Runtime already has an owning writer; use its local service');
    }
  }
  attach() { this.assert(); this.leases++; }
  detach() { if(--this.leases===0)this.close(); }
  assert() { if(!this.active) throw Error('Runtime writer is closed'); }
  close() { if(this.active){this.active=false; this.db.close();} }
}
export function assertNoLinks(path:string) {
  for(let p=resolve(path);;p=dirname(p)) {
    if(existsSync(p)&&lstatSync(p).isSymbolicLink()) throw Error('Redirected project/runtime path refused');
    if(dirname(p)===p)break;
  }
}
