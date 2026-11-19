import { useRef, useState } from 'react';
import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Platform, View } from 'react-native';
import { Text } from '../typography';
import { rpc } from './api';
import { Button, s } from './workspaceDesign';

export function WorkflowDocument({ org, record, kind, canUpload = false, onUploaded }: {
  org: string; record: string; kind: 'contract' | 'receipt'; canUpload?: boolean; onUploaded?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const working = useRef(false);
  const args = { p_org: org, p_kind: kind, p_record: record };

  async function act(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setStatus('');
    try { await action(); }
    catch (error) {
      setStatus(error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Document could not be opened.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function upload() {
    const picked = await getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    const local = Platform.OS === 'web' ? null : new File(asset.uri);
    try {
      if ((asset.size ?? local?.size ?? 0) > 2_097_152) throw new Error('Use a PDF of 2 MB or less.');
      const content = local ? await local.base64() : (asset.base64 ?? asset.uri).replace(/^data:[^,]*,/, '');
      await rpc('hr_save_workflow_document', { ...args, p_name: asset.name, p_content: content });
      setStatus('PDF attached.');
      onUploaded?.();
    } finally {
      if (local?.exists) local.delete();
    }
  }

  async function open() {
    const document: { name: string; content: string } | null = await rpc('hr_get_workflow_document', args);
    if (!document) { setStatus('No PDF has been attached yet.'); return; }
    const name = document.name.replace(/[^a-zA-Z0-9 ._-]/g, '_').replace(/\.pdf$/i, '') + '.pdf';
    if (Platform.OS === 'web') {
      const bytes = Uint8Array.from(atob(document.content), letter => letter.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const download = window.document.createElement('a');
      download.href = url;
      download.download = name;
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (!await isAvailableAsync()) throw new Error('Opening PDFs is unavailable on this device.');
    const file = new File(Paths.cache, record + '-' + Date.now() + '.pdf');
    try {
      await file.write(document.content, { encoding: 'base64' });
      await shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
    } finally {
      if (file.exists) file.delete();
    }
  }

  return <View style={s.form}>
    <View style={s.row}>
      <Button label={kind === 'contract' ? 'Open contract PDF' : 'Open receipt PDF'} secondary disabled={busy} onPress={() => void act(open)} />
      {canUpload && <Button label={kind === 'contract' ? 'Attach contract PDF' : 'Attach receipt PDF'} secondary disabled={busy} onPress={() => void act(upload)} />}
    </View>
    {!!status && <Text accessibilityLiveRegion="polite" style={s.small}>{status}</Text>}
  </View>;
}
