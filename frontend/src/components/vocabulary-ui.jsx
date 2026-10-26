'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { normalizeAnswer } from '@shared/vocabulary.js';

export const CATEGORIES = ['Quotidien', 'Travail', 'Informatique', 'Grammaire'];
const EMPTY_WORD = { english: '', french: '', category: 'Quotidien', example: '', example_fr: '', note: '' };
const STATUS_LABELS = { new: 'Nouveau', learning: 'En cours', mastered: 'Acquis' };
export const statusOf = (word) => Number(word.stage) >= 3 ? 'mastered' : Number(word.review_count) > 0 ? 'learning' : 'new';

export const Category = ({ category }) => (
  <Badge variant="secondary" className={`category-pill category-${normalizeAnswer(category).replace(/[^a-z]/g, '')}`}>
    {category}
  </Badge>
);

export const Status = ({ word }) => (
  <Badge variant="outline" className={`status-pill ${statusOf(word)}`}>{STATUS_LABELS[statusOf(word)]}</Badge>
);

// Un sélecteur partagé conserve les mêmes interactions clavier sur tous les écrans.
export const AppSelect = ({ value, onValueChange, options, className, id, 'aria-label': ariaLabel, ...props }) => (
  <Select value={String(value)} onValueChange={onValueChange} {...props}>
    <SelectTrigger id={id} aria-label={ariaLabel} className={cn('select-control w-full', className)}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent position="popper" align="start">
      {options.map((option) => {
        const item = typeof option === 'object' ? option : { value: option, label: option };
        return <SelectItem key={item.value} value={String(item.value)}>{item.label}</SelectItem>;
      })}
    </SelectContent>
  </Select>
);

export const Modal = ({ title, description, children, onClose }) => {
  // Le secours au montage précède l’autoFocus éventuel d’un champ du formulaire.
  const returnFocus = useRef(typeof document === 'undefined' ? null : document.activeElement);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="app-dialog"
        onOpenAutoFocus={(event) => {
          const activeElement = document.activeElement;
          if (activeElement && !event.currentTarget?.contains(activeElement)) returnFocus.current = activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="app-dialog-header">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description || 'Consulte et organise ton carnet personnel Valen Learning.'}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
};

export const WordForm = ({ word, saving, unavailable = false, reconnecting = false, onReconnect, onSave, onClose }) => {
  const [form, setForm] = useState({ ...EMPTY_WORD, ...word });
  const [error, setError] = useState('');
  const field = (key) => ({ value: form[key] || '', onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })) });
  const submit = async (event) => {
    event.preventDefault();
    if (saving || unavailable) return;
    setError('');
    if (!form.english.trim() || !form.french.trim()) {
      setError('Ajoute le mot anglais et sa traduction française.');
      return;
    }
    try { await onSave(form); } catch (issue) { setError(issue.message); }
  };
  return (
    <Modal title={word?.id ? 'Modifier ce mot' : 'Ajouter un mot'} description="Une traduction, un exemple et un nouveau mot à retenir." onClose={onClose}>
      <form onSubmit={submit}>
        <fieldset className="modal-body form-grid" disabled={saving}>
          <div className="form-field">
            <Label htmlFor="word-english">Mot ou expression en anglais <span aria-hidden="true">*</span></Label>
            <Input id="word-english" autoFocus required maxLength={160} placeholder="to improve" lang="en" {...field('english')} />
          </div>
          <div className="form-field">
            <Label htmlFor="word-french">Traduction française <span aria-hidden="true">*</span></Label>
            <Input id="word-french" required maxLength={400} placeholder="améliorer / progresser" aria-describedby="word-variants" {...field('french')} />
            <small id="word-variants">Sépare les variantes acceptées par « / ».</small>
          </div>
          <div className="form-field full-width">
            <Label htmlFor="word-category">Catégorie</Label>
            <AppSelect id="word-category" disabled={saving} value={form.category} onValueChange={(value) => setForm((current) => ({ ...current, category: value }))} options={[...new Set([...CATEGORIES, form.category])].filter(Boolean)} />
          </div>
          <div className="form-field full-width">
            <Label htmlFor="word-example">Exemple en anglais</Label>
            <Input id="word-example" maxLength={800} placeholder="I want to improve my English." lang="en" {...field('example')} />
          </div>
          <div className="form-field full-width">
            <Label htmlFor="word-example-fr">Traduction de l’exemple</Label>
            <Input id="word-example-fr" maxLength={800} placeholder="Je veux améliorer mon anglais." {...field('example_fr')} />
          </div>
          <div className="form-field full-width">
            <Label htmlFor="word-note">Une note pour t’en souvenir</Label>
            <Textarea id="word-note" rows={2} maxLength={1000} placeholder="Un contexte, une astuce, une nuance…" {...field('note')} />
          </div>
          {error && <p role="alert" className="error-text full-width">{error}</p>}
          {unavailable && <div className="info-banner error full-width" role="alert"><p>La connexion au serveur est interrompue. Ta saisie reste dans cette fenêtre.</p><Button type="button" variant="outline" disabled={reconnecting} onClick={onReconnect}>{reconnecting ? 'Reconnexion…' : 'Réessayer la connexion'}</Button></div>}
        </fieldset>
        <footer className="modal-actions">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Annuler</Button>
          <Button disabled={saving || unavailable} type="submit">
            {saving ? <LoaderCircle className="spinner" size={17} /> : <Plus size={17} />}
            {word?.id ? 'Enregistrer' : 'Ajouter à mon vocabulaire'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
};
