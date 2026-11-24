# Integração VITA Android ↔ VITA Web

## Projeto Firebase compartilhado
Os dois projetos usam o Firebase `vita-sendemail` e o mesmo Firebase Authentication.
O UID autenticado identifica o documento de cada usuário.

## Dados sincronizados
- `users/{uid}`: perfil (`nome`, `peso`, `altura`, `pesoMeta`, `meta`,
  `nivelExercicio`, `idr`, `metaAgua`, `sexo`, `nascimento`).
- `users/{uid}/refeicoes`: registros com `data`, `tipo`, `alimentos` e totais
  nutricionais (`total_calorias`, `total_carboidratos`,
  `total_proteinas`, `total_gorduras`).
- `users/{uid}/agua`: registros com `data` e `quantidade_ml`.

## Comportamento no Web
`js/DashboardController.js` usa `onSnapshot()` para observar o documento do
perfil e as duas subcoleções. Alterações feitas pelo Android são refletidas
no dashboard sem atualizar a página:
- cards de calorias, proteínas, carboidratos e água do dia;
- gráfico de calorias dos últimos sete dias;
- alimentos mais registrados;
- hidratação dos últimos sete dias;
- refeições por tipo.

A página `perfil.html` também observa `users/{uid}` e apresenta os dados
atuais de perfil, incluindo peso, meta de peso, meta de água, IMC e IDR.

O documento legado `users/{uid}/dashboard/summary` continua sendo usado
apenas para manter o gráfico de progresso de peso e, quando disponível,
a série antiga de atividade. O documento `dashboard/profile` é consultado
apenas para preservar as conquistas já existentes.

## Observação sobre o tipo de refeição
No Android desta versão, `AddFragment.kt` grava `tipo = "Almoço"` para
todos os registros. Portanto, o gráfico Web apresenta os tipos que realmente
estão gravados; para diferenciar café da manhã, almoço, jantar e lanches,
será necessário adicionar a escolha do tipo no fluxo Android.

## Regras do Firestore
O Web precisa permitir leitura autenticada de `users/{uid}` e das subcoleções
`refeicoes` e `agua` para o próprio UID. As regras atuais do projeto Firebase
não vieram nos arquivos ZIP, então devem ser conferidas no Console Firebase.
