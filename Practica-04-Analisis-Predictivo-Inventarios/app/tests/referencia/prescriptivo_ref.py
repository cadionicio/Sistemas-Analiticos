"""Referencia INDEPENDIENTE (Python) del Paso 8: fórmulas de inventario, simulación (s,Q) determinista exacta y Monte Carlo de un producto real."""
import json, math, numpy as np, pandas as pd
from statistics import NormalDist
E={}
# 1) Fórmulas con valores de libro
z=NormalDist().inv_cdf(0.95)
E['z95']=z
E['ss_ejemplo']=z*math.sqrt(15*(20**2)+ (100**2)*(5**2))      # LT=15 d, σd=20, d=100, σLT=5
E['rop_ejemplo']=100*15+E['ss_ejemplo']
E['eoq_ejemplo']=math.sqrt(2*36500*150/(0.2*10))              # D=36 500/año, S=150, H=0,2×10
# 2) Simulación determinista: d=10/día, LT=10 (σ=0), s=100, Q=200, stock0=300, 183 días, costo=2, tasa=0.365 (hold=0.002/día·unid.), S=150
def sim_det():
    stock=300; pend=0; arr={}; ords=0; c=0; acum=0; dem=0; serv=0
    for d in range(183):
        if d in arr: stock+=arr.pop(d); pend-=200
        D=10; sv=min(stock,D); stock-=sv; dem+=D; serv+=sv
        if stock+pend<=100: arr[d+10]=arr.get(d+10,0)+200; pend+=200; ords+=1; c+=150
        c+=stock*2*0.365/365; acum+=stock
    return dict(fill=serv/dem, ordenes=ords, stock_prom=acum/183, costo=c)
E['det']=sim_det()
# 3) Monte Carlo independiente de MATPRIMA-003 (demanda diaria bootstrap, LT~N(15,5) trunc ≥1, ventas perdidas)
k=pd.read_csv('/home/claude/dev/F0/kardex_normalizado.csv',parse_dates=['fecha'])
k=k[(k.code=='MATPRIMA-003')&(k.fecha<='2010-05-31')]
dias=pd.date_range('2009-01-02','2010-05-31')
serie=k.groupby('fecha').sal.sum().reindex(dias,fill_value=0).values
m=k.groupby(k.fecha.dt.strftime('%Y-%m')).sal.sum().reindex(pd.period_range('2009-01','2010-05',freq='M').strftime('%Y-%m'),fill_value=0).values
E['matprima003']=dict(dias=len(serie),dem_mes_media=float(m.mean()),dem_mes_sd=float(m.std(ddof=0)))
def mc(stock0,s,Q,N=4000,seed=7):
    rng=np.random.default_rng(seed); fills=[]
    for _ in range(N):
        stock=max(0,stock0); pend=0; arr={}; dem=0; serv=0
        for d in range(183):
            if d in arr: stock+=arr.pop(d); pend-=Q
            D=serie[rng.integers(len(serie))]; sv=min(stock,D); stock-=sv; dem+=D; serv+=sv
            if stock+pend<=s:
                lt=max(1,round(15+5*rng.standard_normal())); arr[d+lt]=arr.get(d+lt,0)+Q; pend+=Q
        fills.append(serv/dem if dem>0 else 1)
    return float(np.mean(fills))
E['mc_params']=dict(stock0=12773.34,s=8436.0,Q=12422)
E['mc_fill']=mc(12773.34,8436.0,12422)
json.dump(E,open('tests/fixtures/esperado_prescriptivo.json','w'),indent=1)
print(json.dumps(E,indent=0)[:900])
