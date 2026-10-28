import type { LocalStore } from '@amara/database';
import { employeesForBranch } from '../lib/misc-v2';
import type { Employee } from '../lib/misc-v2';

/** Empleados que pueden aparecer como "quien vende": vendedores y gerentes activos de la sucursal (datos del último pull). */
export async function loadEmployees(store: LocalStore, branchId: string, current: { id: string; name: string; role: string }): Promise<Employee[]> {
  const rows = await store.db.all<{ id: string; name: string; role: string; active: number; branch_ids_json: string }>('SELECT id, name, role, active, branch_ids_json FROM users_local');
  return employeesForBranch(rows, branchId, current);
}
