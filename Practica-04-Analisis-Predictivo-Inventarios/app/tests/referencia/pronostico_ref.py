"""Implementación de REFERENCIA independiente (Python/numpy) de los modelos, el backtest y el bootstrap del Paso 7.
Se escribe desde las definiciones documentadas (no se traduce el código TypeScript) y sirve de oráculo para las pruebas."""
import json, numpy as np, pandas as pd

G05=[round(0.05*i,2) for i in range(1,20)]; G1=[round(0.1*i,1) for i in range(1,10)]

def naive(y): return dict(m='Naive',r=list(np.diff(y)),f=lambda H: [y[-1]]*H)
def snaive(y):
    if len(y)<24: return None
    return dict(m='Naive estacional',r=[y[t]-y[t-12] for t in range(12,len(y))],f=lambda H: [y[len(y)-12+((h-1)%12)] for h in range(1,H+1)])
def ma6(y):
    if len(y)<8: return None
    return dict(m='Media móvil (6)',r=[y[t]-np.mean(y[t-6:t]) for t in range(6,len(y))],f=lambda H: [float(np.mean(y[-6:]))]*H)
def ses(y):
    best=None
    for a in G05:
        l=y[0]; sse=0; r=[]
        for t in range(1,len(y)): e=y[t]-l; r.append(e); sse+=e*e; l+=a*e
        if best is None or sse<best[0]-1e-9: best=(sse,a,l,r)
    _,a,l,r=best; return dict(m='SES',p={'alfa':a},r=r,f=lambda H: [l]*H)
def holt(y):
    if len(y)<8: return None
    best=None
    for a in G1:
        for b in G1:
            l=y[0]; tr=y[1]-y[0]; sse=0; r=[]
            for t in range(1,len(y)):
                e=y[t]-(l+tr); r.append(e); sse+=e*e; ln=a*y[t]+(1-a)*(l+tr); tr=b*(ln-l)+(1-b)*tr; l=ln
            if best is None or sse<best[0]-1e-9: best=(sse,a,b,l,tr,r)
    _,a,b,l,tr,r=best; return dict(m='Holt',p={'alfa':a,'beta':b},r=r,f=lambda H: [l+h*tr for h in range(1,H+1)])
def hw(y):
    if len(y)<24: return None
    m=12; best=None
    for a in G1:
        for b in G1:
            for g in G1:
                l=np.mean(y[:m]); tr=(np.mean(y[m:2*m])-l)/m; s=[v-l for v in y[:m]]; sse=0; r=[]
                for t in range(m,len(y)):
                    st=s[t-m]; e=y[t]-(l+tr+st); r.append(e); sse+=e*e
                    ln=a*(y[t]-st)+(1-a)*(l+tr); tr=b*(ln-l)+(1-b)*tr; s.append(g*(y[t]-ln)+(1-g)*st); l=ln
                if best is None or sse<best[0]-1e-9: best=(sse,a,b,g,l,tr,s[-m:],r)
    _,a,b,g,l,tr,s,r=best; return dict(m='Holt-Winters aditivo',p={'alfa':a,'beta':b,'gamma':g},r=r,f=lambda H: [l+h*tr+s[(h-1)%12] for h in range(1,H+1)])
def croston_family(y,var):
    a=0.1; bt=0.1; nz=[i for i,v in enumerate(y) if v>0]
    if not nz: return None
    i0=nz[0]; z=y[i0]; p=i0+1; q=1; pr=1/p; fac=(1-a/2) if var=='SBA' else 1; r=[]
    f=lambda: pr*z if var=='TSB' else fac*z/p
    for t in range(i0+1,len(y)):
        r.append(y[t]-f())
        if var=='TSB':
            pr+=bt*((1 if y[t]>0 else 0)-pr)
            if y[t]>0: z+=a*(y[t]-z)
        elif y[t]>0: z+=a*(y[t]-z); p+=a*(q-p); q=1
        else: q+=1
    v=f(); return dict(m=var,r=r,f=lambda H: [v]*H)
CONT=[('Naive',naive,2),('Naive estacional',snaive,24),('Media móvil (6)',ma6,8),('SES',ses,6),('Holt',holt,8),('Holt-Winters aditivo',hw,24)]
INTER=[('Naive',naive,2),('Media móvil (6)',ma6,8),('SES',ses,6),('Croston',lambda y:croston_family(y,'Croston'),6),('SBA',lambda y:croston_family(y,'SBA'),6),('TSB',lambda y:croston_family(y,'TSB'),6)]

def evaluar(mods,y,H=6,maxO=12,noneg=False):
    n=len(y); minE=max([mo for _,_,mo in mods]+[6])
    orig=[k for k in range(max(minE,n-(maxO+H-1)),n)]
    out={}
    for nom,fn,mo in mods:
        errs=[]
        for k in orig:
            tr=y[:k]
            if len(tr)<mo: continue
            a=fn(tr)
            if a is None: errs=None; break
            f=a['f'](H); esc=np.mean(np.abs(np.diff(tr))) or 1
            for h in range(1,H+1):
                if k+h-1<n:
                    fh=max(0,f[h-1]) if noneg else f[h-1]; errs.append((h,abs(y[k+h-1]-fh)/esc))
        if not errs: out[nom]=float('inf'); continue
        out[nom]=float(np.mean([np.mean([e for hh,e in errs if hh==h]) for h in range(1,H+1) if any(hh==h for hh,_ in errs)]))
    sel=min(out, key=lambda k:(out[k],[m[0] for m in mods].index(k)))
    # empate: el primero en la lista con el mínimo
    mn=min(out.values()); sel=[m[0] for m in mods if out[m[0]]<=mn+1e-9][0]
    return out,sel

def boot(aj_fn,y,H,N,seed,noneg):
    """Bootstrap re-implementado: para cada trayectoria se reajusta el ESTADO simulando con la recursión del modelo (vía reajuste incremental).
    Para SES/Naive se usa la recursión explícita; suficiente para validar la serie total de ventas (SES)."""
    a=aj_fn(y); rng=np.random.default_rng(seed); res=np.array(a['r'])
    alfa=a['p']['alfa']; l0=a['f'](1)[0]
    tot=np.zeros(N); pm=np.zeros((H,N))
    for i in range(N):
        l=l0; s=0
        for h in range(H):
            v=l+res[rng.integers(len(res))]
            if noneg and v<0: v=0
            pm[h,i]=v; s+=v; l=l+alfa*(v-l)
        tot[i]=s
    return dict(p10=float(np.quantile(tot,.1)),p50=float(np.quantile(tot,.5)),p90=float(np.quantile(tot,.9)),m1p50=float(np.quantile(pm[0],.5)))

v=pd.read_excel('tests/fixtures/ventas.xlsx'); v.columns=['n','ruc','cliente','dir','depto','soles','sku','vol','fecha','util']
v['per']=v.fecha.dt.strftime('%Y-%m'); v=v[v.per<='2019-03']
per=sorted(v.per.unique())
E={}
for col,noneg in [('soles',True),('util',False),('vol',True)]:
    y=[float(x) for x in v.groupby('per')[col].sum().reindex(per).values]
    ev,sel=evaluar(CONT,y,noneg=noneg); a=dict(CONT)[sel] if False else [fn for nom,fn,_ in CONT if nom==sel][0](y)
    E[col]=dict(mase=ev,seleccionado=sel,params=a.get('p',{}),puntual=a['f'](6))
E['soles']['boot']=boot(ses,[float(x) for x in v.groupby('per').soles.sum().reindex(per).values],6,10000,24092026,True)
k=pd.read_csv('/home/claude/dev/F0/kardex_normalizado.csv',parse_dates=['fecha']); k['per']=k.fecha.dt.strftime('%Y-%m'); k=k[k.per<='2010-05']
kp=sorted(k.per.unique()); yk=[float(x) for x in k.groupby('per').sal.sum().reindex(kp).fillna(0).values]
ev,sel=evaluar(INTER,yk,noneg=True); a=[fn for nom,fn,_ in INTER if nom==sel][0](yk)
E['kardex_total']=dict(mase=ev,seleccionado=sel,puntual=a['f'](6))
for cod in ['MATPRIMA-003','TB60-3.00','TW0-FLAT']:
    yy=[float(x) for x in k[k.code==cod].groupby('per').sal.sum().reindex(kp).fillna(0).values]
    ev,sel=evaluar(INTER,yy,maxO=6,noneg=True); a=[fn for nom,fn,_ in INTER if nom==sel][0](yy)
    E['kardex_'+cod]=dict(mase=ev,seleccionado=sel,puntual=a['f'](6))
json.dump(E,open('tests/fixtures/esperado_pronostico.json','w'),indent=1,ensure_ascii=False)
for kk,vv in E.items(): print(kk, vv['seleccionado'], vv.get('params'), [round(x,2) for x in vv['puntual']][:3], vv.get('boot',''))
