
I’d like you to generate code and configuration for a Kubernetes-based microservice.

### Objective:

Build a **Kubernetes microservice** in Node.js (choose best-suited libraries for handling HTTP, PostgreSQL, and calling a local LLM), which does the following:

  

### Functionality Requirements:

1.  **Expose a POST API endpoint**, which receives JSON payloads from another internal microservice. The request body is similar to a webhook from the Retell service after a call ends.
    
2.  **Example POST body (JSON):**
    

\`\`\`

{

"event": "call\_ended",

"call": {

"call\_type": "phone\_call",

"from\_number": "+12137771234",

"to\_number": "+12137771235",

"direction": "inbound",

"call\_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",

"agent\_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",

"call\_status": "registered",

"metadata": {},

"retell\_llm\_dynamic\_variables": {

"customer\_name": "John Doe"

},

"start\_timestamp": 1714608475945,

"end\_timestamp": 1714608491736,

"disconnection\_reason": "user\_hangup",

"transcript": "....",

"opt\_out\_sensitive\_data\_storage": false,

"survey\_id": 12345

}

}

\`\`\`

  

3.**Header values are not required to be parsed**, but assume the header may contain an `x-retell-signature` for future validation.

  

### Processing Logic:

1.  **Extract from the request:**
    
    *   `transcript` (text)
        
    *   All fields from `retell_llm_dynamic_variables` (dictionary)
        
    *   `survey_id` (string, used as the key in DB)
        
2.  **Construct a prompt for a local LLM (****served by** **Ollama) in this format:**
    

\`\`\`Write a concise summary of the following:

  

"{{ transcript }}"

"{{ retell\_llm\_dynamic\_variables as a dictionary }}"

  

CONCISE SUMMARY:

\`\`\`

**3.If transcript is too long**, split it into multiple chunks (max token length per request assumed to be 2048 unless otherwise specified). Get partial summaries and concatenate or re-summarize if needed.

**4\.** **Call the local Ollama API** (assume it's running locally at `http://localhost:11434/api/generate` or similar). Use appropriate payload and headers for that.

  
  

**5\.** **Update a PostgreSQL table** with the result.

  

### PostgreSQL Notes:

*   Table name and database connection details (host, database name, etc.) should come from **Kubernetes ConfigMap** (via environment variables).
    
*   PostgreSQL **username and password** should come from a **Kubernetes Secret** (via environment variables).
    
*   Assume table has at least:
    
    *   `id` (integer, primary key or unique)
        
    *   `call_summary` (use type `TEXT` for long summary content)
        

Update the row where `id` matches, by writing the generated summary to the `call_summary` field.

  

### Kubernetes Setup:

*   Generate:
    
    *   A **Dockerfile**
        
    *   A **Kubernetes Deployment YAML**
        
    *   A **Service YAML** (ClusterIP)
        
    *   A **ConfigMap** example with DB host, port, table, DB name
        
    *   A **Secret** example with DB username and password
        

### Tests:

*   Include a minimal test (unit or integration) to simulate receiving a webhook payload and ensuring correct summary generation and DB update.
*   

Create Node.js microservice with comprehensive logging
Implement POST endpoint with processed field check
Add PostgreSQL integration with processed field logic
Implement Ollama LLM integration with ConfigMap/Secret configuration
Create Dockerfile for containerization
Generate Kubernetes Deployment YAML
Create Kubernetes Service YAML
Generate ConfigMap for database and Ollama configuration
Create Secret for database and Ollama credentials
Write unit/integration tests
Create documentation and setup instructions