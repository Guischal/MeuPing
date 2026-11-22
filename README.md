# Meu Ping

*PARA INICIAR O BACK*
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

*PARA INICIAR O FRONT*
cd frontend
npm run dev

**Sua conexão, em detalhes.**

Sistema local de monitoramento de desempenho de rede.

## Tecnologias
- Frontend: React + Vite + Recharts + Lucide
- Backend: Python + FastAPI
- Medição: speedtest-cli (servidores públicos do Speedtest)
- Histórico: SQLite

## Requisitos
- Python 3.10 ou superior
- Node.js 20 ou superior (inclui npm)
- Conexão com a internet

## 1. Abrir no VS Code
1. Extraia `meu_ping_revisado.zip`.
2. Abra a pasta `meuping` no VS Code: **File > Open Folder**.
3. Abra dois terminais integrados: **Terminal > New Terminal**.

## 2. Executar o backend
No primeiro terminal:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Se o PowerShell bloquear a ativação do ambiente virtual, execute no terminal atual:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Se `py` não existir, tente `python` no comando de criação do ambiente.

O backend ficará em `http://127.0.0.1:8000`.
Documentação automática da API: `http://127.0.0.1:8000/docs`.

## 3. Executar o frontend
No segundo terminal, a partir da pasta principal `meuping`:

```powershell
cd frontend
npm install
npm run dev
```

Abra o endereço mostrado pelo Vite, normalmente `http://localhost:5173`.

## 4. Como usar
1. Deixe os dois terminais abertos.
2. Abra o site no navegador.
3. Clique em **Iniciar teste**.
4. Aguarde a medição terminar. O Speedtest escolhe um servidor público adequado e mede ping, download e upload.
5. O resultado é salvo no banco SQLite `backend/netmonitor.db`.
6. O dashboard atualiza os três indicadores, a classificação da conexão e o gráfico de velocidade.
7. A página **Histórico** consulta as medições salvas.

## Como o sistema funciona
- O React apresenta a interface e envia uma requisição HTTP `POST /api/test` quando o botão é acionado.
- O FastAPI executa a medição no backend usando a biblioteca `speedtest-cli`.
- O backend retorna ping, download e upload. As velocidades são convertidas para Mbps.
- O resultado recebe uma classificação indicativa baseada em regras simples e é gravado no SQLite.
- O frontend consulta `GET /api/history` e utiliza os registros para montar o gráfico de Download e Upload.
- `GET /api/health` informa se o backend está acessível.

## Observações importantes
- O teste usa servidores públicos do Speedtest; resultados variam conforme horário, servidor, Wi-Fi/cabo, roteador, provedor e tráfego da rede.
- O ping apresentado é a latência medida até o servidor selecionado pelo Speedtest, não necessariamente até um servidor de jogo.
- Download e upload medem a conexão com o servidor de teste. Não representam uma garantia da velocidade contratada.
- O teste pode levar algumas dezenas de segundos e consumir tráfego de internet.
- A classificação “Excelente / Boa / Regular / Ruim” é uma estimativa didática baseada em limites configuráveis no backend, não um padrão universal.
- O histórico é local e fica no arquivo SQLite. Não apague `netmonitor.db` se quiser preservar as medições.
- O projeto ainda não realiza monitoramento contínuo em segundo plano. Uma expansão planejada é um agente local opcional, instalado no computador, para manter as medições mesmo quando o site estiver fechado.
- Outra expansão planejada é um módulo de jogos, com seleção de jogo e região para acompanhar ping, jitter, perda de pacotes, disponibilidade de servidores e histórico.
- Essas expansões são planejadas e ainda não fazem parte das funcionalidades implementadas nesta versão.

## Estrutura
```text
meuping/
├── backend/
│   ├── app/
│   │   └── main.py
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── styles.css
```
