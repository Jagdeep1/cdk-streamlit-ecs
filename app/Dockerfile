FROM python:3.8-slim-buster

RUN apt-get update && \
    apt-get install -y build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN pip install streamlit

WORKDIR /app
COPY . /app

EXPOSE 8501

CMD ["streamlit", "run", "app.py"]
