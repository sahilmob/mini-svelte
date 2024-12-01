<script>
  let counter = 0;
  let double = 2;
  const increment = () => {
    counter++;
    double++;
  };
  const decrement = () => counter--;
</script>

<button on:click={decrement}>Decrement</button>
<div>{counter}</div>
<div>{counter * double}</div>
<button on:click={increment}>Increment</button>
