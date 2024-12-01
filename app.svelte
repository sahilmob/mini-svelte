<script>
  let counter = 0;
  $: quadruple = double * 2;
  $: double = counter * 2;
  const increment = () => {
    counter += 1;
  };
  const decrement = () => counter--;
</script>

<button on:click={decrement}>Decrement</button>
<div>counter = {counter}</div>
<div>counter * 2 = {double}</div>
<div>counter * 4 = {quadruple}</div>
<button on:click={increment}>Increment</button>
