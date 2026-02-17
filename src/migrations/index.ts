import * as migration_20260203_063024 from './20260203_063024';
import * as migration_20260215_add_list_style_type from './20260215_add_list_style_type';

export const migrations = [
  {
    up: migration_20260203_063024.up,
    down: migration_20260203_063024.down,
    name: '20260203_063024'
  },
  {
    up: migration_20260215_add_list_style_type.up,
    down: migration_20260215_add_list_style_type.down,
    name: '20260215_add_list_style_type'
  },
];
