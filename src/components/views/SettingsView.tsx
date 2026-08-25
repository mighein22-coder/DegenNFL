import React from 'react';
import { ViewStub } from './ViewStub';

export const SettingsView: React.FC = () => (
  <ViewStub
    title="Settings"
    summary="Your name, avatar and password."
    needs={[
      'Name and avatar update via the profiles table (only those columns are grantable to a member).',
      'Password change through supabase.auth.updateUser().',
      'Role is deliberately not editable here and cannot be written by a member — see 0001_init.sql.',
    ]}
  />
);
