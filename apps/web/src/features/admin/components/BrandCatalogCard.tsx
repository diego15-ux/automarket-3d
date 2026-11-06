'use client';

import { BrandCreateSchema, BrandNameSchema, ModelNameSchema, type AdminBrandDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, PencilLine, Plus, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Field, Input } from '@/shared/ui/field';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys } from '../api';

/** «Corolla, Hilux; Yaris» → ['Corolla', 'Hilux', 'Yaris'] */
const splitNames = (value: string) =>
  value
    .split(/[,;\n]/)
    .map(name => name.trim())
    .filter(Boolean);

function BrandRow({ brand, onChange }: { brand: AdminBrandDTO; onChange: (brands: AdminBrandDTO[]) => void }) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [models, setModels] = useState('');
  const [error, setError] = useState<string>();
  const fail = (err: Error) => setError(err.message);
  const done = (brands: AdminBrandDTO[]) => {
    setError(undefined);
    onChange(brands);
  };

  const rename = useMutation({ mutationFn: (name: string) => adminApi.updateBrand(brand.id, { name }), onSuccess: brands => (done(brands), setRenaming(false)), onError: fail });
  const toggle = useMutation({
    mutationFn: () => adminApi.updateBrand(brand.id, { isActive: !brand.isActive }),
    onSuccess: brands => {
      done(brands);
      toast({ tone: 'success', title: brand.isActive ? `${brand.name} ya no aparece al publicar` : `${brand.name} vuelve a aparecer al publicar` });
    },
    onError: fail,
  });
  const addModels = useMutation({ mutationFn: (names: string[]) => adminApi.addModels(brand.id, names), onSuccess: brands => (done(brands), setModels('')), onError: fail });
  const toggleModel = useMutation({ mutationFn: (model: { id: string; isActive: boolean }) => adminApi.setModelActive(model.id, !model.isActive), onSuccess: done, onError: fail });

  function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = BrandNameSchema.safeParse(new FormData(event.currentTarget).get('name'));
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    if (parsed.data === brand.name) return setRenaming(false);
    rename.mutate(parsed.data);
  }

  function onAddModels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const names = splitNames(models);
    const invalid = names.map(name => ModelNameSchema.safeParse(name)).find(result => !result.success);
    if (!names.length) return setError('Escribe al menos un modelo.');
    if (invalid && !invalid.success) return setError(invalid.error.issues[0]?.message);
    addModels.mutate(names);
  }

  return (
    <li className={cn('py-4', !brand.isActive && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {renaming ? (
          <form onSubmit={onRename} className="flex items-center gap-1.5">
            <Input name="name" defaultValue={brand.name} aria-label={`Nuevo nombre de ${brand.name}`} className="h-9 w-48 text-sm" autoFocus />
            <Button type="submit" size="icon" variant="ghost" aria-label="Guardar nombre" loading={rename.isPending} className="size-9">
              <Check className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Cancelar" onClick={() => setRenaming(false)} className="size-9">
              <X className="size-4" />
            </Button>
          </form>
        ) : (
          <p className="font-medium">{brand.name}</p>
        )}
        <span className="text-[13px] text-muted">{brand.vehicles === 1 ? '1 anuncio' : `${brand.vehicles} anuncios`}</span>
        {!brand.isActive && <Badge>No aparece al publicar</Badge>}
        <div className="ml-auto flex gap-1">
          {!renaming && (
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
              <PencilLine className="size-3.5" aria-hidden />
              Renombrar
            </Button>
          )}
          <Button size="sm" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate()}>
            {brand.isActive ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {brand.models.length === 0 && <span className="text-[13px] text-muted">Sin modelos sugeridos: el vendedor escribe el suyo.</span>}
        {brand.models.map(model => (
          <button
            key={model.id}
            type="button"
            onClick={() => toggleModel.mutate(model)}
            aria-pressed={model.isActive}
            title={model.isActive ? 'Clic para dejar de sugerirlo' : 'Clic para volver a sugerirlo'}
            className={cn('rounded-sm border px-2 py-0.5 text-[13px] transition-colors', model.isActive ? 'border-edge text-ink hover:border-ink' : 'border-dashed border-edge/60 text-muted line-through')}
          >
            {model.name}
          </button>
        ))}
      </div>

      <form onSubmit={onAddModels} className="mt-2.5 flex max-w-lg gap-2">
        <Input value={models} onChange={event => setModels(event.target.value)} placeholder="Agregar modelos: Corolla, Hilux…" aria-label={`Agregar modelos a ${brand.name}`} className="h-9 text-sm" />
        <Button type="submit" size="sm" variant="outline" loading={addModels.isPending}>
          <Plus className="size-3.5" aria-hidden />
          Agregar
        </Button>
      </form>
      {error && <p className="mt-1.5 text-[13px] text-danger-fg">{error}</p>}
    </li>
  );
}

/**
 * Catálogo de marcas: el formulario de publicar solo ofrece las activas, con su ortografía
 * oficial. Arrancó con las marcas de los anuncios que ya había en la base.
 */
export function BrandCatalogCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const brands = useQuery({ queryKey: adminKeys.brands, queryFn: adminApi.brands });
  const missing = useQuery({ queryKey: adminKeys.missingBrands, queryFn: adminApi.missingBrands });
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = (next: AdminBrandDTO[]) => {
    queryClient.setQueryData(adminKeys.brands, next);
    void queryClient.invalidateQueries({ queryKey: adminKeys.history });
    void queryClient.invalidateQueries({ queryKey: adminKeys.missingBrands });
  };
  const importMissing = useMutation({
    mutationFn: adminApi.importBrandsFromListings,
    onSuccess: next => {
      update(next);
      toast({ tone: 'success', title: 'Marcas agregadas desde los anuncios' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudieron importar', description: err.message }),
  });
  const create = useMutation({
    mutationFn: adminApi.createBrand,
    onSuccess: (next, input) => {
      update(next);
      setErrors({});
      toast({ tone: 'success', title: `${input.name} agregada al catálogo`, description: 'Ya aparece en el formulario de publicar.' });
    },
    onError: err => setErrors({ name: err.message }),
  });

  const visible = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase('es');
    return (brands.data ?? []).filter(brand => !term || brand.name.toLocaleLowerCase('es').includes(term) || brand.models.some(model => model.name.toLocaleLowerCase('es').includes(term)));
  }, [brands.data, filter]);

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = BrandCreateSchema.safeParse({ name: data.get('brand'), models: splitNames(String(data.get('models') ?? '')) });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0] === 'models' ? 'models' : 'name', issue.message])));
      return;
    }
    create.mutate(parsed.data, { onSuccess: () => form.reset() });
  }

  const active = brands.data?.filter(brand => brand.isActive).length ?? 0;
  return (
    <Card id="marcas" className="scroll-mt-24 p-5">
      <h2 className="text-lg font-extrabold">Marcas y modelos</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        El formulario de publicar solo ofrece las marcas activas. Los modelos son sugerencias: el vendedor puede escribir otro. Desactivar una marca no toca los anuncios que ya la usan.
      </p>

      <form onSubmit={onCreate} className="mt-5 grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-start" noValidate>
        <Field label="Marca nueva" htmlFor="brand" error={errors.name}>
          <Input id="brand" name="brand" placeholder="Mercedes-Benz" aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Modelos (opcional)" htmlFor="models" error={errors.models} hint="Sepáralos con comas.">
          <Input id="models" name="models" placeholder="Clase C, GLA 200" />
        </Field>
        <Button type="submit" loading={create.isPending} className="sm:mt-6.5">
          <Plus className="size-4" aria-hidden />
          Agregar marca
        </Button>
      </form>

      {missing.data && missing.data.length > 0 && (
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3 rounded-sm border border-gold/40 bg-gold/[0.06] p-4">
          <div className="min-w-0 max-w-2xl text-sm">
            <p className="font-medium">
              {missing.data.length === 1 ? '1 marca de los anuncios no está en el catálogo' : `${missing.data.length} marcas de los anuncios no están en el catálogo`}
            </p>
            <p className="mt-1 text-muted">
              {missing.data
                .slice(0, 8)
                .map(brand => `${brand.name} (${brand.vehicles})`)
                .join(', ')}
              {missing.data.length > 8 ? '…' : ''}. {brands.data?.length ? 'Mientras no estén, nadie puede publicar autos nuevos de esas marcas.' : ''}
            </p>
          </div>
          <Button size="sm" variant="outline" loading={importMissing.isPending} onClick={() => importMissing.mutate()}>
            Agregarlas con sus modelos
          </Button>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-sm text-muted">{brands.data ? `${brands.data.length} marcas · ${active} activas` : ' '}</p>
        <Input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Buscar marca o modelo" aria-label="Buscar en el catálogo" className="h-9 w-56 text-sm" />
      </div>

      {brands.isPending ? (
        <PageSpinner />
      ) : brands.isError ? (
        <p className="mt-4 text-danger-fg">{brands.error.message}</p>
      ) : brands.data.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-edge/60 p-5 text-sm text-muted">
          Aún no hay marcas. Mientras el catálogo esté vacío, el vendedor escribe la marca a mano. En cuanto agregues la primera, solo se aceptarán las del catálogo.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map(brand => (
            <BrandRow key={`${brand.id}-${brand.name}-${brand.isActive}`} brand={brand} onChange={update} />
          ))}
          {visible.length === 0 && <li className="py-4 text-sm text-muted">Nada coincide con «{filter}».</li>}
        </ul>
      )}
    </Card>
  );
}
