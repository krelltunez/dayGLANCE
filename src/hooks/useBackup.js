import { useState } from 'react';

const useBackup = () => {
  const [pendingBackupFile, setPendingBackupFile] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showBackupMenu, setShowBackupMenu] = useState(false);

  return {
    pendingBackupFile, setPendingBackupFile,
    showRestoreConfirm, setShowRestoreConfirm,
    showBackupMenu, setShowBackupMenu,
  };
};

export default useBackup;
